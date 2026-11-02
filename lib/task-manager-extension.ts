/**
 * The queue's tools, as one Pi extension.
 *
 * `lib/rpc-manager.ts` loads this factory only for the task manager project, so
 * the tools exist in exactly one working directory and cannot be selected from
 * the browser, a tool preset, or another project. Everything they do goes
 * through `lib/tasks/agent-tools.ts`; this module declares the schemas, turns
 * results into text, and owns the watch that wakes an idle session.
 */
import { Type } from '@earendil-works/pi-ai';
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type InlineExtension,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent';
import { getAgentDir } from './session-reader';
import { registerSessionLivenessProvider } from './session-liveness';
import {
  formatTaskEventDigest,
  formatTaskToolResult,
  queueSnapshot,
  TaskTools,
  type TaskToolResult,
  type TaskWatchBudget
} from './tasks/agent-tools';
import { getTaskOrchestrator } from './tasks/orchestrator';

export const TASK_MANAGER_EXTENSION_NAME = 'pie-task-manager';

/** The custom message a wake or a replay appends to the transcript. */
export const TASK_EVENT_CUSTOM_TYPE = 'pie-task-event';

/** One poll per 1.5 s: the same design the board uses, not a second transport. */
export const TASK_WATCH_POLL_MS = 1_500;
/** A watch ends after this many wakes... */
export const TASK_WATCH_MAX_WAKES = 100;
/** ...or this much wall-clock time, whichever comes first. */
export const TASK_WATCH_MAX_DURATION_MS = 2 * 60 * 60 * 1000;
/** How many events a restart replay summarises, so a long absence stays one digest. */
export const TASK_WATCH_REPLAY_LIMIT = 20;

const TASK_STATUS_SCHEMA = Type.Union([
  Type.Literal('PENDING'),
  Type.Literal('IN_PROGRESS'),
  Type.Literal('DONE'),
  Type.Literal('BLOCKED'),
  Type.Literal('FAILED')
]);

const TASK_CONTROL_SCHEMA = Type.Union([
  Type.Literal('start'),
  Type.Literal('pause'),
  Type.Literal('resume'),
  Type.Literal('abort'),
  Type.Literal('retry'),
  Type.Literal('markDone')
]);

/** Every tool carries these: the queue is serial, and its state is the context. */
const GUIDELINES = [
  'The queue runs one task at a time. Each tool result ends with the queue state and the events that happened since your last call; read them before deciding what to do next.',
  'Every task needs a title that names the outcome and a cwd inside an allowed project directory. Add verification commands when you know them.',
  'Ask the user before deleting a task, aborting a run, or marking work done without a run, and pass confirm: true only after they agree.'
];

export interface TaskManagerExtensionOptions {
  /** Tests shorten the poll; a session uses the documented 1.5 s. */
  pollMs?: number;
  maxWakes?: number;
  maxDurationMs?: number;
  now?: () => number;
}

interface ActiveWatch {
  sessionId: string;
  sessionFile: string | undefined;
  startedAt: number;
  timer: ReturnType<typeof setInterval>;
  releaseLiveness: () => void;
}

interface WatchOutcome {
  ok: boolean;
  code?: string;
  error?: string;
  watch?: TaskWatchBudget & { sessionId: string };
}

function toolsFor(sessionId: string): TaskTools {
  const orchestrator = getTaskOrchestrator();
  return new TaskTools({
    queue: orchestrator.queue,
    store: orchestrator.queue.store,
    orchestrator,
    sessionId,
    agentDir: getAgentDir()
  });
}

function respond(result: TaskToolResult) {
  return {
    content: [{ type: 'text' as const, text: formatTaskToolResult(result) }],
    details: result
  };
}

export function createTaskManagerExtension(
  options: TaskManagerExtensionOptions = {}
): InlineExtension {
  const pollMs = options.pollMs ?? TASK_WATCH_POLL_MS;
  const maxWakes = options.maxWakes ?? TASK_WATCH_MAX_WAKES;
  const maxDurationMs = options.maxDurationMs ?? TASK_WATCH_MAX_DURATION_MS;
  const now = options.now ?? (() => Date.now());

  return {
    name: TASK_MANAGER_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      const orchestrator = () => getTaskOrchestrator();
      const store = () => orchestrator().queue.store;
      let watch: ActiveWatch | null = null;

      const snapshot = () => queueSnapshot(orchestrator().status());

      const budget = (): TaskWatchBudget => {
        const row = store().getWatch();
        return {
          wakes: row?.wakes ?? 0,
          maxWakes,
          startedAt: row?.startedAt ?? new Date(now()).toISOString(),
          maxDurationMs
        };
      };

      const watchFacts = (): WatchOutcome => {
        const row = store().getWatch();
        if (!row) return { ok: true, watch: undefined };
        return {
          ok: true,
          watch: {
            sessionId: row.sessionId,
            startedAt: row.startedAt,
            wakes: row.wakes,
            maxWakes,
            maxDurationMs
          }
        };
      };

      const queueIsIdle = (): boolean => {
        const state = orchestrator().queue.getQueueState();
        if (state.state !== 'IDLE') return false;
        return orchestrator()
          .queue.listTasks()
          .every((task) => task.status !== 'PENDING' && task.status !== 'IN_PROGRESS');
      };

      /** Release the timer and the liveness provider, then forget the row. */
      const stopWatch = (sessionId: string): void => {
        if (watch && watch.sessionId === sessionId) {
          clearInterval(watch.timer);
          watch.releaseLiveness();
          watch = null;
        }
        store().clearWatch(sessionId);
      };

      /**
       * Stop and tell the model why. Used for a budget or an idle queue, not for
       * an explicit stop: a person who says stop does not need a turn to hear it.
       */
      const endWatch = (sessionId: string, reason: string): void => {
        const row = store().getWatch();
        const wakes = row?.wakes ?? 0;
        stopWatch(sessionId);
        pi.sendMessage(
          {
            customType: TASK_EVENT_CUSTOM_TYPE,
            content: `Task watch ended (${reason}) after ${wakes} of ${maxWakes} wakes. Ask for it again with task_watch: "on".`,
            display: true
          },
          { triggerTurn: true, deliverAs: 'followUp' }
        );
      };

      /**
       * One poll: read what is new for this session, drop its own calls, and wake
       * it once with a digest. Every guard is here so a watcher cannot outlive its
       * budget or keep spending turns on an idle queue.
       */
      const tick = (sessionId: string): void => {
        if (!watch || watch.sessionId !== sessionId) return;
        try {
          // Another session took the row over (this one's row was stale, or a
          // restart cleared it): drop our timer without touching its watch.
          const row = store().getWatch();
          if (!row || row.sessionId !== sessionId) {
            stopWatch(sessionId);
            return;
          }
          if (now() - watch.startedAt >= maxDurationMs) {
            endWatch(sessionId, 'time budget');
            return;
          }
          const page = store().readSessionEvents(sessionId);
          const events = page.events.filter((event) => event.originSessionId !== sessionId);
          if (events.length === 0) return;

          if ((row?.wakes ?? 0) >= maxWakes) {
            endWatch(sessionId, 'wake budget');
            return;
          }

          const digest = formatTaskEventDigest(events, snapshot(), {
            ...budget(),
            wakes: (row?.wakes ?? 0) + 1
          });
          pi.sendMessage(
            { customType: TASK_EVENT_CUSTOM_TYPE, content: digest, display: true },
            { triggerTurn: true, deliverAs: 'followUp' }
          );
          const bumped = store().bumpWatchWakes();

          if ((bumped?.wakes ?? 0) >= maxWakes) {
            endWatch(sessionId, 'wake budget');
            return;
          }
          if (queueIsIdle()) endWatch(sessionId, 'queue idle');
        } catch (error) {
          console.warn('[pie] the task watch could not poll the queue:', error);
        }
      };

      const beginWatch = (ctx: ExtensionContext): WatchOutcome => {
        const sessionId = ctx.sessionManager.getSessionId();
        const row = store().getWatch();
        if (row && row.sessionId !== sessionId) {
          const stale =
            now() - Date.parse(row.startedAt) >= maxDurationMs || row.wakes >= maxWakes;
          if (!stale) {
            return {
              ok: false,
              code: 'watch_held',
              error: `Session ${row.sessionId} is already watching the queue`
            };
          }
        }
        if (watch) stopWatch(watch.sessionId);

        const startedAt = new Date(now()).toISOString();
        store().setWatch(sessionId, startedAt);
        const releaseLiveness = registerSessionLivenessProvider({
          name: 'pie-task-watch',
          sessionId,
          ...(ctx.sessionManager.getSessionFile()
            ? { sessionFile: ctx.sessionManager.getSessionFile() }
            : {}),
          isActive: () => watch !== null && watch.sessionId === sessionId
        });
        const timer = setInterval(() => tick(sessionId), pollMs);
        timer.unref?.();
        watch = { sessionId, sessionFile: ctx.sessionManager.getSessionFile(), startedAt: now(), timer, releaseLiveness };
        return {
          ok: true,
          watch: { sessionId, startedAt, wakes: 0, maxWakes, maxDurationMs }
        };
      };

      /**
       * After a restart nothing is watching, and the backlog is real. Replay one
       * non-triggering digest so the session knows what changed without spending a
       * turn on a queue it is not driving.
       */
      const replay = (ctx: ExtensionContext): void => {
        try {
          const sessionId = ctx.sessionManager.getSessionId();
          const row = store().getWatch();
          if (row?.sessionId === sessionId) {
            // This process has no watch for it: the previous one is gone.
            store().clearWatch(sessionId);
          }
          const cursor = store().getEventCursor(sessionId);
          const last = store().lastEventId();
          if (last <= cursor) return;
          const from = Math.max(cursor, last - TASK_WATCH_REPLAY_LIMIT);
          const events = store()
            .listEventsSince(from, TASK_WATCH_REPLAY_LIMIT)
            .filter((event) => event.originSessionId !== sessionId);
          store().setEventCursor(sessionId, last);
          if (events.length === 0) return;
          pi.sendMessage({
            customType: TASK_EVENT_CUSTOM_TYPE,
            content: `Since this session last read the queue:\n${formatTaskEventDigest(events, snapshot())}`,
            display: true
          });
        } catch (error) {
          console.warn('[pie] the task manager could not replay the queue:', error);
        }
      };

      pi.on('session_start', (_event, ctx) => {
        replay(ctx);
      });
      pi.on('session_shutdown', (_event, ctx) => {
        const sessionId = ctx.sessionManager.getSessionId();
        if (watch && watch.sessionId === sessionId) stopWatch(sessionId);
      });

      register({
        pi,
        tool: defineTool({
          name: 'task_list',
          label: 'List tasks',
          description:
            'List the queue, the queue state, and optionally the recent run history. Read this before changing the queue.',
          promptSnippet: 'Read the task queue',
          promptGuidelines: GUIDELINES,
          executionMode: 'sequential',
          parameters: Type.Object({
            status: Type.Optional(TASK_STATUS_SCHEMA),
            includeRuns: Type.Optional(
              Type.Boolean({ description: 'Include the recent run history.' })
            )
          }),
          async execute(_id, params, _signal, _onUpdate, ctx) {
            return respond(await toolsFor(ctx.sessionManager.getSessionId()).list(params));
          }
        })
      });

      register({
        pi,
        tool: defineTool({
          name: 'task_create',
          label: 'Add a task',
          description:
            'Add a task to the end of the queue. It stays PENDING until the queue runs it.',
          promptSnippet: 'Add a task to the queue',
          promptGuidelines: GUIDELINES,
          executionMode: 'sequential',
          parameters: Type.Object({
            title: Type.String({ description: 'A short title that names the outcome.' }),
            description: Type.Optional(
              Type.String({ description: 'What to do, and anything the agent must know.' })
            ),
            cwd: Type.String({ description: 'The project directory the task runs in.' }),
            allowAskUser: Type.Optional(
              Type.Union([Type.Boolean(), Type.Null()], {
                description:
                  'Whether the task may ask the user a question. Null or omitted uses the queue default.'
              })
            ),
            verifyCommands: Type.Optional(
              Type.Union([Type.Array(Type.String()), Type.Null()], {
                description:
                  'Commands that must pass for the task to count as done. Null or omitted uses the queue default.'
              })
            )
          }),
          async execute(_id, params, _signal, _onUpdate, ctx) {
            return respond(await toolsFor(ctx.sessionManager.getSessionId()).create(params));
          }
        })
      });

      register({
        pi,
        tool: defineTool({
          name: 'task_update',
          label: 'Edit a task',
          description: 'Change a queued or finished task. A running task cannot be edited.',
          promptSnippet: 'Edit a task',
          promptGuidelines: GUIDELINES,
          executionMode: 'sequential',
          parameters: Type.Object({
            id: Type.Number({ description: 'The task id.' }),
            title: Type.Optional(Type.String()),
            description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            cwd: Type.Optional(Type.String()),
            allowAskUser: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
            verifyCommands: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()]))
          }),
          async execute(_id, params, _signal, _onUpdate, ctx) {
            return respond(await toolsFor(ctx.sessionManager.getSessionId()).update(params));
          }
        })
      });

      register({
        pi,
        tool: defineTool({
          name: 'task_move',
          label: 'Reorder a task',
          description: 'Move a queued task up, down, or to a 1-based position in the queue.',
          promptSnippet: 'Reorder the queue',
          promptGuidelines: GUIDELINES,
          executionMode: 'sequential',
          parameters: Type.Object({
            id: Type.Number({ description: 'The task id.' }),
            direction: Type.Optional(Type.Union([Type.Literal('up'), Type.Literal('down')])),
            position: Type.Optional(
              Type.Number({ description: '1-based position among the queued tasks.' })
            )
          }),
          async execute(_id, params, _signal, _onUpdate, ctx) {
            return respond(await toolsFor(ctx.sessionManager.getSessionId()).move(params));
          }
        })
      });

      register({
        pi,
        tool: defineTool({
          name: 'task_delete',
          label: 'Delete tasks',
          description:
            'Delete tasks by id, by list of ids, or every finished task. Requires confirm: true.',
          promptSnippet: 'Delete tasks',
          promptGuidelines: GUIDELINES,
          executionMode: 'sequential',
          parameters: Type.Object({
            id: Type.Optional(Type.Number({ description: 'One task id.' })),
            ids: Type.Optional(Type.Array(Type.Number(), { description: 'Several task ids.' })),
            completed: Type.Optional(
              Type.Boolean({ description: 'Delete every finished task instead of named ones.' })
            ),
            confirm: Type.Optional(
              Type.Boolean({ description: 'Must be true; the call is refused without it.' })
            )
          }),
          async execute(_id, params, _signal, _onUpdate, ctx) {
            return respond(await toolsFor(ctx.sessionManager.getSessionId()).delete(params));
          }
        })
      });

      register({
        pi,
        tool: defineTool({
          name: 'task_control',
          label: 'Control the queue',
          description:
            'Start, pause, resume, or abort the queue; retry a blocked or failed task; mark a task done by hand. Abort and markDone require confirm: true. Starting turns the watch on.',
          promptSnippet: 'Start, pause, resume, abort, retry, or finish the queue',
          promptGuidelines: GUIDELINES,
          executionMode: 'sequential',
          parameters: Type.Object({
            action: TASK_CONTROL_SCHEMA,
            id: Type.Optional(Type.Number({ description: 'Required for retry and markDone.' })),
            note: Type.Optional(
              Type.String({ description: 'A reason, stored with the transition.' })
            ),
            confirm: Type.Optional(
              Type.Boolean({ description: 'Required for abort and markDone.' })
            )
          }),
          async execute(_id, params, _signal, _onUpdate, ctx) {
            const result = await toolsFor(ctx.sessionManager.getSessionId()).control(params);
            if (result.ok && params.action === 'start') {
              const outcome = beginWatch(ctx);
              result.data = {
                ...(result.data ?? {}),
                watch: outcome.ok
                  ? (outcome.watch ?? { watching: true })
                  : { watching: false, error: outcome.error }
              };
            }
            return respond(result);
          }
        })
      });

      register({
        pi,
        tool: defineTool({
          name: 'task_answer',
          label: 'Answer a task question',
          description:
            'Answer or dismiss the question the running task is waiting on. Relay the question to the user first unless they told you to decide.',
          promptSnippet: 'Answer the running task question',
          promptGuidelines: GUIDELINES,
          executionMode: 'sequential',
          parameters: Type.Object({
            id: Type.Number({ description: 'The task id that asked.' }),
            answer: Type.Optional(Type.String({ description: 'The answer to deliver.' })),
            cancelled: Type.Optional(
              Type.Boolean({ description: 'Dismiss the question instead of answering it.' })
            )
          }),
          async execute(_id, params, _signal, _onUpdate, ctx) {
            return respond(await toolsFor(ctx.sessionManager.getSessionId()).answer(params));
          }
        })
      });

      register({
        pi,
        tool: defineTool({
          name: 'task_config',
          label: 'Queue defaults',
          description:
            'Read or change the queue defaults: verification commands, timeouts, ask_user policy, standing instructions, and the task model.',
          promptSnippet: 'Read or change the queue defaults',
          promptGuidelines: GUIDELINES,
          executionMode: 'sequential',
          parameters: Type.Object({
            update: Type.Optional(
              Type.Object({
                model: Type.Optional(
                  Type.Union([
                    Type.Object({ provider: Type.String(), modelId: Type.String() }),
                    Type.Null()
                  ])
                ),
                verifyCommands: Type.Optional(Type.Array(Type.String())),
                verifyTimeoutMs: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
                taskTimeoutMs: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
                allowAskUser: Type.Optional(Type.Boolean()),
                instructions: Type.Optional(Type.String())
              })
            )
          }),
          async execute(_id, params, _signal, _onUpdate, ctx) {
            return respond(await toolsFor(ctx.sessionManager.getSessionId()).config(params));
          }
        })
      });

      register({
        pi,
        tool: defineTool({
          name: 'task_watch',
          label: 'Watch the queue',
          description:
            'Turn on the watch that wakes this session when a task is claimed, settles, asks a question, or the queue pauses. It ends after a budget, when the queue is idle, or when you turn it off. Only one session watches at a time.',
          promptSnippet: 'Wake this session when the queue changes',
          promptGuidelines: GUIDELINES,
          executionMode: 'sequential',
          parameters: Type.Object({
            action: Type.Union([Type.Literal('on'), Type.Literal('off'), Type.Literal('status')])
          }),
          async execute(_id, params, _signal, _onUpdate, ctx) {
            const sessionId = ctx.sessionManager.getSessionId();
            let outcome: WatchOutcome;
            if (params.action === 'on') {
              outcome = beginWatch(ctx);
            } else if (params.action === 'off') {
              stopWatch(sessionId);
              outcome = { ok: true };
            } else {
              outcome = watchFacts();
            }
            const result: TaskToolResult = {
              ok: outcome.ok,
              ...(outcome.code ? { code: outcome.code } : {}),
              ...(outcome.error ? { error: outcome.error } : {}),
              queue: snapshot(),
              events: [],
              data: {
                watching: watch !== null,
                watch: outcome.watch ?? null,
                budget: { maxWakes, maxDurationMs, pollMs }
              }
            };
            return respond(result);
          }
        })
      });

      register({
        pi,
        tool: defineTool({
          name: 'task_events',
          label: 'Read queue events',
          description:
            'Read the queue events this session has not seen, optionally waiting a bounded time for one to arrive.',
          promptSnippet: 'Read the queue events',
          promptGuidelines: GUIDELINES,
          executionMode: 'sequential',
          parameters: Type.Object({
            afterId: Type.Optional(
              Type.Number({ description: 'Read the events after this id instead of the cursor.' })
            ),
            limit: Type.Optional(Type.Number()),
            waitMs: Type.Optional(
              Type.Number({ description: 'Wait up to 50000 ms for a first event.' })
            )
          }),
          async execute(_id, params, _signal, _onUpdate, ctx) {
            return respond(await toolsFor(ctx.sessionManager.getSessionId()).events(params));
          }
        })
      });
    }
  };
}

interface ToolRegistration {
  pi: ExtensionAPI;
  tool: ToolDefinition;
}

function register({ pi, tool }: ToolRegistration): void {
  pi.registerTool(tool);
}
