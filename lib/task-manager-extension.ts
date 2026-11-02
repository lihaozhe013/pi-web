/**
 * The queue's tools, as one Pi extension.
 *
 * `lib/rpc-manager.ts` loads this factory only for the task manager project, so
 * the tools exist in exactly one working directory and cannot be selected from
 * the browser, a tool preset, or another project. Everything they do goes
 * through `lib/tasks/agent-tools.ts`; this module only declares the schemas and
 * turns results into text.
 */
import { Type } from '@earendil-works/pi-ai';
import {
  defineTool,
  type ExtensionAPI,
  type InlineExtension,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent';
import { getAgentDir } from './session-reader';
import {
  formatTaskToolResult,
  TaskTools,
  type TaskToolResult
} from './tasks/agent-tools';
import { getTaskOrchestrator } from './tasks/orchestrator';

export const TASK_MANAGER_EXTENSION_NAME = 'pie-task-manager';

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

interface ToolRegistration {
  pi: ExtensionAPI;
  tool: ToolDefinition;
}

function register({ pi, tool }: ToolRegistration): void {
  pi.registerTool(tool);
}

export function createTaskManagerExtension(): InlineExtension {
  return {
    name: TASK_MANAGER_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
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
            'Start, pause, resume, or abort the queue; retry a blocked or failed task; mark a task done by hand. Abort and markDone require confirm: true.',
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
            return respond(await toolsFor(ctx.sessionManager.getSessionId()).control(params));
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
