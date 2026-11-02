/**
 * The queue tools an operator session can call.
 *
 * Nothing here knows about Pi: every method validates its input, calls the same
 * `TaskQueue` and `TaskOrchestrator` the board uses, and returns a plain object.
 * The extension in `lib/task-manager-extension.ts` only turns these results into
 * tool output, which keeps the rules testable without an agent runtime.
 *
 * Two invariants shape every method:
 *
 * - No SQL. A tool that wrote the database directly would bypass the claim
 *   guard, the fencing token, and the working-directory allow-list.
 * - Every result carries the queue snapshot and the events newer than this
 *   session's cursor, so one call always leaves the model grounded in what
 *   actually happened.
 */
import { getAgentDir } from '../session-reader';
import { configChangeSummary, readTaskConfig, writeTaskConfig } from './config';
import { parseTaskConfigPatch } from './config-fields';
import type { TaskOrchestrator } from './orchestrator';
import { clipOutputTail, TaskQueue } from './queue';
import { TASK_EVENT_PAGE_LIMIT, type TaskStore } from './store';
import type {
  OrchestratorStatus,
  QueueState,
  TaskConfig,
  TaskEvent,
  TaskRecord,
  TaskRunRecord,
  TaskStatus
} from './types';

export const TASK_MANAGER_TOOL_NAMES = [
  'task_list',
  'task_create',
  'task_update',
  'task_move',
  'task_delete',
  'task_control',
  'task_answer',
  'task_config',
  'task_watch',
  'task_events'
] as const;

export type TaskManagerToolName = (typeof TASK_MANAGER_TOOL_NAMES)[number];

/** The queue state every result and digest describes. */
export function queueSnapshot(status: OrchestratorStatus): TaskQueueSnapshot {
  return {
    state: status.state,
    activeTaskId: status.activeTaskId,
    pausedReason: status.pausedReason,
    running: status.running
  };
}

/** `task_events` waits at most this long, inside one tool call. */
export const TASK_EVENTS_MAX_WAIT_MS = 50_000;
export const TASK_EVENTS_POLL_MS = 250;

/** A task result is a digest line, not a run log. */
const TASK_TOOL_SUMMARY_MAX_LENGTH = 2_000;

export interface TaskToolOptions {
  queue: TaskQueue;
  store: TaskStore;
  orchestrator: TaskOrchestrator;
  /** The calling session. Its cursor decides which events a result carries. */
  sessionId: string;
  /** Where the queue defaults live; defaults to the shared agent directory. */
  agentDir?: string;
}

export interface TaskQueueSnapshot {
  state: QueueState;
  activeTaskId: number | null;
  pausedReason: string | null;
  running: boolean;
}

/** What every tool call answers with, whether it succeeded or was refused. */
export interface TaskToolResult {
  ok: boolean;
  /** A refusal code such as `task_locked`; absent on success. */
  code?: string;
  /** A sentence the model can act on; absent on success. */
  error?: string;
  queue: TaskQueueSnapshot;
  /** Events this session had not seen before this call. */
  events: TaskEvent[];
  data?: Record<string, unknown>;
}

export interface TaskListParams {
  status?: TaskStatus;
  includeRuns?: boolean;
}

export interface TaskCreateParams {
  title: string;
  description?: string | null;
  cwd: string;
  allowAskUser?: boolean | null;
  verifyCommands?: string[] | null;
}

export interface TaskUpdateParams extends Partial<TaskCreateParams> {
  id: number;
}

export interface TaskMoveParams {
  id: number;
  direction?: 'up' | 'down';
  position?: number;
}

export interface TaskDeleteParams {
  id?: number;
  ids?: number[];
  /** Delete every finished task. Requires `confirm`. */
  completed?: boolean;
  confirm?: boolean;
}

export interface TaskControlParams {
  action: 'start' | 'pause' | 'resume' | 'abort' | 'retry' | 'markDone';
  id?: number;
  note?: string;
  confirm?: boolean;
}

export interface TaskAnswerParams {
  id: number;
  answer?: string;
  cancelled?: boolean;
}

export interface TaskConfigParams {
  update?: Partial<TaskConfig>;
}

export interface TaskEventsParams {
  afterId?: number;
  limit?: number;
  waitMs?: number;
}

function refusal(code: string, message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  throw error;
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'internal_error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function requireId(value: unknown): number {
  const id = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(id) || id <= 0) refusal('invalid_input', 'A task id is required');
  return id;
}

function taskSummary(task: TaskRecord): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    cwd: task.cwd,
    attempts: task.attempts,
    resultSummary: task.resultSummary ? clipOutputTail(task.resultSummary, 500) : null,
    pendingQuestion: task.pendingQuestion?.question ?? null
  };
}

function runSummary(run: TaskRunRecord): Record<string, unknown> {
  return {
    taskId: run.taskId,
    attempt: run.attempt,
    status: run.status,
    exitCode: run.exitCode,
    verifyExit: run.verifyExit,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt
  };
}

export class TaskTools {
  private readonly queue: TaskQueue;
  private readonly store: TaskStore;
  private readonly orchestrator: TaskOrchestrator;
  private readonly sessionId: string;
  private readonly agentDir: string;

  constructor(options: TaskToolOptions) {
    this.queue = options.queue;
    this.store = options.store;
    this.orchestrator = options.orchestrator;
    this.sessionId = options.sessionId;
    this.agentDir = options.agentDir ?? getAgentDir();
  }

  // ------------------------------------------------------------------- reading

  async list(params: TaskListParams = {}): Promise<TaskToolResult> {
    const tasks = this.queue
      .listTasks()
      .filter((task) => !params.status || task.status === params.status)
      .map(taskSummary);
    const data: Record<string, unknown> = { tasks };
    if (params.includeRuns) data.runs = this.queue.listRuns().map(runSummary);
    return this.success(data);
  }

  /**
   * Read the events this session has not seen. `waitMs` is a bounded long poll:
   * it exists so a caller can wait for a settle inside one turn, and it is not
   * the mechanism the watcher uses.
   */
  async events(params: TaskEventsParams = {}): Promise<TaskToolResult> {
    const limit = Math.min(Math.max(params.limit ?? TASK_EVENT_PAGE_LIMIT, 1), TASK_EVENT_PAGE_LIMIT);
    const deadline = Date.now() + Math.min(Math.max(params.waitMs ?? 0, 0), TASK_EVENTS_MAX_WAIT_MS);
    const afterId = params.afterId;
    let events: TaskEvent[] = [];

    const read = () => {
      if (afterId !== undefined) {
        const page = this.store.listEventsSince(afterId, limit);
        if (page.length > 0) this.store.setEventCursor(this.sessionId, page[page.length - 1].id);
        return page;
      }
      return this.store.readSessionEvents(this.sessionId, limit).events;
    };

    try {
      events = read();
      while (events.length === 0 && Date.now() < deadline) {
        await delay(Math.min(TASK_EVENTS_POLL_MS, Math.max(deadline - Date.now(), 0)));
        events = read();
      }
    } catch (error) {
      return this.failure(error);
    }
    return this.success(
      { events: events.map(eventSummary), cursor: this.store.getEventCursor(this.sessionId) },
      events
    );
  }

  // ------------------------------------------------------------------ writing

  async create(params: TaskCreateParams): Promise<TaskToolResult> {
    return this.attempt(async () => {
      const task = await this.queue.createTask({
        title: params.title,
        description: params.description ?? null,
        cwd: params.cwd,
        allowAskUser: params.allowAskUser ?? null,
        verifyCommands: params.verifyCommands ?? null
      });
      return { task: taskSummary(task) };
    });
  }

  async update(params: TaskUpdateParams): Promise<TaskToolResult> {
    return this.attempt(async () => {
      const id = requireId(params.id);
      const task = await this.queue.updateTask(id, {
        title: params.title,
        description: params.description,
        cwd: params.cwd,
        allowAskUser: params.allowAskUser,
        verifyCommands: params.verifyCommands
      });
      return { task: taskSummary(task) };
    });
  }

  async move(params: TaskMoveParams): Promise<TaskToolResult> {
    return this.attempt(() => {
      const id = requireId(params.id);
      const tasks = this.queue.moveTask(id, {
        direction: params.direction,
        position: params.position
      });
      return {
        order: tasks.filter((task) => task.status === 'PENDING').map((task) => task.id)
      };
    });
  }

  async delete(params: TaskDeleteParams): Promise<TaskToolResult> {
    return this.attempt(() => {
      if (params.confirm !== true) {
        refusal('confirmation_required', 'Deleting a task needs confirm: true; ask the user first');
      }
      if (params.completed === true) {
        const done = this.queue.listTasks().filter((task) => task.status === 'DONE');
        for (const task of done) this.queue.deleteTask(task.id);
        return { deleted: done.map((task) => task.id) };
      }
      const ids = params.ids ?? (params.id !== undefined ? [params.id] : []);
      if (ids.length === 0) refusal('invalid_input', 'Pass an id, ids, or completed: true');
      const deleted: number[] = [];
      for (const value of ids) {
        const id = requireId(value);
        this.queue.deleteTask(id);
        deleted.push(id);
      }
      return { deleted };
    });
  }

  async control(params: TaskControlParams): Promise<TaskToolResult> {
    return this.attempt(async () => {
      switch (params.action) {
        case 'start': {
          if (this.orchestrator.running) {
            refusal('already_running', 'The queue is already running');
          }
          // The loop runs until the queue is empty or paused; awaiting it here
          // would hold the tool call open for the whole run.
          this.orchestrator.start().catch((error) => {
            console.warn('[pie] the task queue could not start:', error);
          });
          return { action: 'start', accepted: true };
        }
        case 'pause':
          await this.orchestrator.pause(params.note, this.sessionId);
          return { action: 'pause' };
        case 'resume':
          await this.orchestrator.resume();
          return { action: 'resume' };
        case 'abort':
          if (params.confirm !== true) {
            refusal('confirmation_required', 'Aborting the running task needs confirm: true');
          }
          await this.orchestrator.abort(this.sessionId);
          return { action: 'abort' };
        case 'retry':
          return {
            action: 'retry',
            task: taskSummary(this.queue.retryTask(requireId(params.id), this.sessionId))
          };
        case 'markDone':
          if (params.confirm !== true) {
            refusal('confirmation_required', 'Marking a task done needs confirm: true');
          }
          return {
            action: 'markDone',
            task: taskSummary(
              this.queue.markDone(requireId(params.id), params.note ?? null, this.sessionId)
            )
          };
        default:
          return refusal('invalid_input', 'action must be start, pause, resume, abort, retry, or markDone');
      }
    });
  }

  async answer(params: TaskAnswerParams): Promise<TaskToolResult> {
    return this.attempt(async () => {
      const id = requireId(params.id);
      if (params.cancelled !== true && !params.answer?.trim()) {
        refusal('invalid_input', 'An answer or cancelled: true is required');
      }
      await this.orchestrator.answer(
        id,
        { answer: params.answer, cancelled: params.cancelled === true },
        this.sessionId
      );
      return { answered: id, cancelled: params.cancelled === true };
    });
  }

  async config(params: TaskConfigParams = {}): Promise<TaskToolResult> {
    return this.attempt(() => {
      if (!params.update || Object.keys(params.update).length === 0) {
        return { config: readTaskConfig(this.agentDir) };
      }
      const before = readTaskConfig(this.agentDir);
      const config = writeTaskConfig(parseTaskConfigPatch({ ...params.update }), this.agentDir);
      this.store.appendEvent({
        kind: 'config',
        summary: configChangeSummary(before, config),
        originSessionId: this.sessionId
      });
      return { config };
    });
  }

  // -------------------------------------------------------------------- results

  private async attempt(
    body: () => Record<string, unknown> | Promise<Record<string, unknown>>
  ): Promise<TaskToolResult> {
    try {
      return this.success(await body());
    } catch (error) {
      return this.failure(error);
    }
  }

  private snapshot(): TaskQueueSnapshot {
    return queueSnapshot(this.orchestrator.status());
  }

  /** The cursor read is best effort: a failure here must not hide the outcome. */
  private unseenEvents(): TaskEvent[] {
    try {
      return this.store.readSessionEvents(this.sessionId).events;
    } catch (error) {
      console.warn('[pie] could not read task events:', error);
      return [];
    }
  }

  private success(data?: Record<string, unknown>, events?: TaskEvent[]): TaskToolResult {
    return {
      ok: true,
      queue: this.snapshot(),
      events: events ?? this.unseenEvents(),
      ...(data ? { data } : {})
    };
  }

  private failure(error: unknown): TaskToolResult {
    return {
      ok: false,
      code: errorCode(error),
      error: errorMessage(error),
      queue: this.snapshot(),
      events: this.unseenEvents()
    };
  }
}

/** One event per line, the way the model reads it in a tool result. */
export function eventSummary(event: TaskEvent): Record<string, unknown> {
  return {
    id: event.id,
    kind: event.kind,
    taskId: event.taskId,
    status: event.status,
    summary: event.summary ? clipOutputTail(event.summary, TASK_TOOL_SUMMARY_MAX_LENGTH) : null,
    createdAt: event.createdAt
  };
}

/**
 * A tool result as text: the outcome first, then the queue, then the data, then
 * the news. The model reads this before deciding what to do next, so the first
 * line has to answer "did it work".
 */
export function formatTaskToolResult(result: TaskToolResult): string {
  const lines: string[] = [];
  lines.push(result.ok ? 'ok' : `refused (${result.code ?? 'internal_error'}): ${result.error ?? 'unknown error'}`);

  const state = [
    `queue ${result.queue.state}`,
    result.queue.running ? 'loop running' : null,
    result.queue.activeTaskId !== null ? `active task ${result.queue.activeTaskId}` : null,
    result.queue.pausedReason ? `paused: ${result.queue.pausedReason}` : null
  ].filter(Boolean);
  lines.push(state.join(', '));

  if (result.data !== undefined) lines.push(JSON.stringify(result.data));

  if (result.events.length > 0) {
    lines.push('events:');
    for (const event of result.events) {
      lines.push(`- ${describeEvent(event)}`);
    }
  }
  return lines.join('\n');
}

/** What a watch costs and has left, so the digest can say when it ends. */
export interface TaskWatchBudget {
  wakes: number;
  maxWakes: number;
  startedAt: string;
  maxDurationMs: number;
}

/**
 * The one message a wake delivers: what changed, then the queue it changed to.
 * It stays short on purpose; a watch that narrated activity would spend the
 * user's tokens on lines that decide nothing.
 */
export function formatTaskEventDigest(
  events: TaskEvent[],
  queue: TaskQueueSnapshot,
  budget?: TaskWatchBudget
): string {
  const lines = events.map((event) => `- ${describeEvent(event)}`);
  const queueLine = [
    `queue ${queue.state}`,
    queue.activeTaskId !== null ? `task ${queue.activeTaskId} running` : null,
    queue.pausedReason ? `paused: ${queue.pausedReason}` : null
  ].filter((part): part is string => Boolean(part));
  if (budget) queueLine.push(`wake ${budget.wakes} of ${budget.maxWakes}`);
  lines.push(queueLine.join(', '));
  return lines.join('\n');
}

function describeEvent(event: TaskEvent): string {
  const parts: string[] = [event.kind];
  if (event.taskId !== null) parts.push(`task ${event.taskId}`);
  if (event.status) parts.push(event.status);
  const head = parts.join(' ');
  return event.summary ? `${head}: ${clipOutputTail(event.summary, 300)}` : head;
}
