/**
 * The queue tools an operator session can call.
 *
 * Nothing here knows about Pi: every method validates its input, calls the same
 * `TaskQueue` and per-project `TaskOrchestrator` the board uses, and returns a
 * plain object. The extension in `lib/task-manager-extension.ts` only turns
 * these results into tool output.
 *
 * Two invariants shape every method:
 *
 * - No SQL. A tool that wrote the database directly would bypass the claim
 *   guard, the fencing token, and the working-directory allow-list.
 * - Every result carries every project's queue snapshot and the events newer
 *   than this session's cursor, so one call always leaves the model grounded in
 *   what actually happened.
 */
import { basename } from 'node:path';
import { getAgentDir } from '../session-reader';
import { configChangeSummary, readTaskConfig, writeTaskConfig } from './config';
import { parseTaskConfigPatch } from './config-fields';
import {
  listTaskProjects,
  type TaskOrchestrator
} from './orchestrator';
import { clipOutputTail, TaskQueue } from './queue';
import { resolveTaskProject } from './projects';
import { TASK_EVENT_PAGE_LIMIT, type TaskStore } from './store';
import type {
  QueueState,
  TaskConfig,
  TaskEvent,
  TaskProjectSummary,
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

/** `task_events` waits at most this long, inside one tool call. */
export const TASK_EVENTS_MAX_WAIT_MS = 50_000;
export const TASK_EVENTS_POLL_MS = 250;

/** A task result is a digest line, not a run log. */
const TASK_TOOL_SUMMARY_MAX_LENGTH = 2_000;

export interface TaskToolOptions {
  queue: TaskQueue;
  store: TaskStore;
  /** The orchestrator that drives one project, resolved lazily. */
  orchestratorFor: (projectKey: string, cwd: string) => TaskOrchestrator;
  /** The calling session. Its cursor decides which events a result carries. */
  sessionId: string;
  /** Where the queue defaults live; defaults to the shared agent directory. */
  agentDir?: string;
}

/** One project's queue as a tool result or digest reports it. */
export interface TaskProjectSnapshot {
  projectKey: string;
  cwd: string;
  state: QueueState;
  activeTaskId: number | null;
  activeTaskTitle: string | null;
  pausedReason: string | null;
  running: boolean;
  pending: number;
  blocked: number;
  failed: number;
  done: number;
}

/** What every tool call answers with, whether it succeeded or was refused. */
export interface TaskToolResult {
  ok: boolean;
  /** A refusal code such as `task_locked`; absent on success. */
  code?: string;
  /** A sentence the model can act on; absent on success. */
  error?: string;
  /** Every project's queue, so the model sees the whole system in one call. */
  projects: TaskProjectSnapshot[];
  /** Events this session had not seen before this call. */
  events: TaskEvent[];
  data?: Record<string, unknown>;
}

export interface TaskListParams {
  status?: TaskStatus;
  /** Limit the list to one project. Omit for every project. */
  cwd?: string;
  includeRuns?: boolean;
}

export interface TaskCreateParams {
  /** A short label; omit it to use the first line of the description. */
  title?: string;
  description?: string | null;
  cwd: string;
  verifyCommands?: string[] | null;
  /** Approve a directory the person named, instead of requiring the board first. */
  authorizeCwd?: boolean;
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
  /** Delete every finished task in the project named by `cwd`. Requires `confirm`. */
  completed?: boolean;
  cwd?: string;
  confirm?: boolean;
}

export interface TaskControlParams {
  action: 'start' | 'pause' | 'resume' | 'abort' | 'retry' | 'markDone';
  /** The project whose queue is controlled; required for start/pause/resume. */
  cwd?: string;
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

/** The wait is awaited, so the timer keeps the loop alive rather than unref'd. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function requireId(value: unknown): number {
  const id = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(id) || id <= 0) refusal('invalid_input', 'A task id is required');
  return id;
}

/** A short, human name for a project key or cwd. */
export function projectLabel(cwdOrKey: string): string {
  if (!cwdOrKey) return 'unknown project';
  return basename(cwdOrKey) || cwdOrKey;
}

function taskSummary(task: TaskRecord): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    projectKey: task.projectKey,
    cwd: task.cwd,
    createdBy: task.createdBy,
    attempts: task.attempts,
    // Long enough to keep a failed verification's own output, which is the part
    // an operator needs; the full text stays on the board.
    resultSummary: task.resultSummary ? clipOutputTail(task.resultSummary, 1_000) : null,
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

export function projectSnapshot(project: TaskProjectSummary): TaskProjectSnapshot {
  return {
    projectKey: project.projectKey,
    cwd: project.cwd,
    state: project.state,
    activeTaskId: project.activeTaskId,
    activeTaskTitle: project.activeTaskTitle,
    pausedReason: project.pausedReason,
    running: project.running,
    pending: project.pending,
    blocked: project.blocked,
    failed: project.failed,
    done: project.done
  };
}

/** The whole system as a tool result or digest reports it. */
export function projectSnapshots(store: TaskStore): TaskProjectSnapshot[] {
  return listTaskProjects(store).map(projectSnapshot);
}

export class TaskTools {
  private readonly queue: TaskQueue;
  private readonly store: TaskStore;
  private readonly orchestratorFor: (projectKey: string, cwd: string) => TaskOrchestrator;
  private readonly sessionId: string;
  private readonly agentDir: string;

  constructor(options: TaskToolOptions) {
    this.queue = options.queue;
    this.store = options.store;
    this.orchestratorFor = options.orchestratorFor;
    this.sessionId = options.sessionId;
    this.agentDir = options.agentDir ?? getAgentDir();
  }

  // ------------------------------------------------------------------- reading

  async list(params: TaskListParams = {}): Promise<TaskToolResult> {
    const project = params.cwd ? this.projectForCwd(params.cwd) : null;
    const tasks = this.queue
      .listTasks(project?.projectKey)
      .filter((task) => !params.status || task.status === params.status)
      .map(taskSummary);
    const data: Record<string, unknown> = { tasks };
    if (params.includeRuns) {
      data.runs = this.queue.listRuns(project?.projectKey).map(runSummary);
    }
    return this.success(data);
  }

  /**
   * Read the events this session has not seen. `waitMs` is a bounded long poll:
   * it exists so a caller can wait for a settle inside one turn, and it is not
   * the mechanism the watcher uses. The cursor is global on purpose: filtering
   * the page by project while advancing one cursor would hide another project's
   * events forever.
   */
  async events(params: TaskEventsParams = {}): Promise<TaskToolResult> {
    const limit = Math.min(
      Math.max(params.limit ?? TASK_EVENT_PAGE_LIMIT, 1),
      TASK_EVENT_PAGE_LIMIT
    );
    const deadline =
      Date.now() + Math.min(Math.max(params.waitMs ?? 0, 0), TASK_EVENTS_MAX_WAIT_MS);
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
        verifyCommands: params.verifyCommands ?? null,
        createdBy: this.sessionId,
        authorizeCwd: params.authorizeCwd === true
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
        verifyCommands: params.verifyCommands,
        authorizeCwd: params.authorizeCwd === true
      });
      return { task: taskSummary(task) };
    });
  }

  async move(params: TaskMoveParams): Promise<TaskToolResult> {
    return this.attempt(() => {
      const id = requireId(params.id);
      const task = this.queue.getTask(id);
      const tasks = this.queue.moveTask(id, {
        direction: params.direction,
        position: params.position
      });
      return {
        projectKey: task.projectKey,
        order: tasks.filter((entry) => entry.status === 'PENDING').map((entry) => entry.id)
      };
    });
  }

  async delete(params: TaskDeleteParams): Promise<TaskToolResult> {
    return this.attempt(() => {
      if (params.confirm !== true) {
        refusal('confirmation_required', 'Deleting a task needs confirm: true; ask the user first');
      }
      if (params.completed === true) {
        const project = this.requireProject(params.cwd, 'Pass cwd to clear completed tasks in one project');
        const done = this.queue
          .listTasks(project.projectKey)
          .filter((task) => task.status === 'DONE');
        for (const task of done) this.queue.deleteTask(task.id);
        return { deleted: done.map((task) => task.id), projectKey: project.projectKey };
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
          const project = this.requireProject(
            params.cwd,
            'Pass cwd to start a project queue'
          );
          const orchestrator = this.orchestratorFor(project.projectKey, project.cwd);
          if (orchestrator.running) {
            refusal('already_running', `The queue for ${projectLabel(project.cwd)} is already running`);
          }
          // The loop runs until the queue is empty or paused; awaiting it here
          // would hold the tool call open for the whole run.
          orchestrator.start().catch((error) => {
            console.warn('[pie] the task queue could not start:', error);
          });
          return { action: 'start', projectKey: project.projectKey, cwd: project.cwd };
        }
        case 'pause': {
          const project = this.requireProject(params.cwd, 'Pass cwd to pause a project queue');
          const status = await this.orchestratorFor(project.projectKey, project.cwd).pause(
            params.note,
            this.sessionId
          );
          return { action: 'pause', projectKey: status.projectKey };
        }
        case 'resume': {
          const project = this.requireProject(params.cwd, 'Pass cwd to resume a project queue');
          const status = await this.orchestratorFor(project.projectKey, project.cwd).resume();
          return { action: 'resume', projectKey: status.projectKey };
        }
        case 'abort': {
          if (params.confirm !== true) {
            refusal('confirmation_required', 'Aborting the running task needs confirm: true');
          }
          const project = params.cwd
            ? this.projectForCwd(params.cwd)
            : params.id !== undefined
              ? this.projectForTask(requireId(params.id))
              : null;
          if (!project) refusal('invalid_input', 'Pass cwd or id to abort a task');
          const status = await this.orchestratorFor(project.projectKey, project.cwd).abort(
            this.sessionId
          );
          return { action: 'abort', projectKey: status.projectKey };
        }
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
          return refusal(
            'invalid_input',
            'action must be start, pause, resume, abort, retry, or markDone'
          );
      }
    });
  }

  async answer(params: TaskAnswerParams): Promise<TaskToolResult> {
    return this.attempt(async () => {
      const id = requireId(params.id);
      if (params.cancelled !== true && !params.answer?.trim()) {
        refusal('invalid_input', 'An answer or cancelled: true is required');
      }
      const task = this.queue.getTask(id);
      await this.orchestratorFor(task.projectKey, task.cwd).answer(
        id,
        { answer: params.answer, cancelled: params.cancelled === true },
        this.sessionId
      );
      return { answered: id, cancelled: params.cancelled === true, projectKey: task.projectKey };
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

  /** Every project's queue, used by results and by the watcher digest. */
  projectsSnapshot(): TaskProjectSnapshot[] {
    return this.projects().map(projectSnapshot);
  }

  private projects(): TaskProjectSummary[] {
    return listTaskProjects(this.store);
  }

  private projectForCwd(cwd: string): TaskProjectSummary | null {
    return resolveTaskProject(this.projects(), cwd);
  }

  private projectForTask(id: number): TaskProjectSummary | null {
    const task = this.queue.getTask(id);
    return resolveTaskProject(this.projects(), task.cwd);
  }

  private requireProject(cwd: string | undefined, message: string): TaskProjectSummary {
    const project = cwd ? this.projectForCwd(cwd) : null;
    if (!project) refusal('invalid_input', message);
    return project;
  }

  private async attempt(
    body: () => Record<string, unknown> | Promise<Record<string, unknown>>
  ): Promise<TaskToolResult> {
    try {
      return this.success(await body());
    } catch (error) {
      return this.failure(error);
    }
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
      projects: this.projectsSnapshot(),
      events: events ?? this.unseenEvents(),
      ...(data ? { data } : {})
    };
  }

  private failure(error: unknown): TaskToolResult {
    return {
      ok: false,
      code: errorCode(error),
      error: errorMessage(error),
      projects: this.projectsSnapshot(),
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
    projectKey: event.projectKey,
    status: event.status,
    summary: event.summary ? clipOutputTail(event.summary, TASK_TOOL_SUMMARY_MAX_LENGTH) : null,
    createdAt: event.createdAt
  };
}

function describeProject(project: TaskProjectSnapshot): string {
  const label = projectLabel(project.cwd || project.projectKey);
  const parts = [`${label} ${project.state}`];
  if (project.running) parts.push('loop running');
  if (project.activeTaskId !== null) {
    parts.push(project.activeTaskTitle ? `task ${project.activeTaskTitle}` : 'task running');
  }
  if (project.pending > 0) parts.push(`${project.pending} queued`);
  if (project.blocked > 0) parts.push(`${project.blocked} blocked`);
  if (project.failed > 0) parts.push(`${project.failed} failed`);
  if (project.pausedReason) parts.push(`paused: ${project.pausedReason}`);
  return parts.join(', ');
}

/**
 * A tool result as text: the outcome first, then the project queues, then the
 * data, then the news. The model reads this before deciding what to do next, so
 * the first line has to answer "did it work".
 */
export function formatTaskToolResult(result: TaskToolResult): string {
  const lines: string[] = [];
  lines.push(
    result.ok
      ? 'ok'
      : `refused (${result.code ?? 'internal_error'}): ${result.error ?? 'unknown error'}`
  );

  const active = result.projects.filter(
    (project) =>
      project.state !== 'IDLE' ||
      project.activeTaskId !== null ||
      project.pending > 0 ||
      project.blocked > 0 ||
      project.failed > 0
  );
  lines.push(
    active.length > 0
      ? active.map(describeProject).join(' · ')
      : 'all project queues idle'
  );

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
  /** When the digest was written, so a late delivery cannot read as current. */
  at?: string;
}

/**
 * The one message a wake delivers: what changed, then the queues it changed to.
 * It stays short on purpose; a watch that narrated activity would spend the
 * user's tokens on lines that decide nothing.
 */
export function formatTaskEventDigest(
  events: TaskEvent[],
  projects: TaskProjectSnapshot[],
  budget?: TaskWatchBudget
): string {
  const lines = events.map((event) => `- ${describeEvent(event)}`);
  const touched = new Set(
    events
      .map((event) => event.projectKey)
      .filter((key): key is string => typeof key === 'string')
  );
  const visible = projects.filter(
    (project) =>
      touched.has(project.projectKey) ||
      project.state !== 'IDLE' ||
      project.activeTaskId !== null ||
      project.pending > 0 ||
      project.blocked > 0 ||
      project.failed > 0
  );
  const queueLine =
    visible.length > 0
      ? `queues: ${visible.map(describeProject).join('; ')}`
      : 'all project queues idle';
  const parts = [queueLine];
  if (budget) parts.push(`wake ${budget.wakes} of ${budget.maxWakes}`);
  if (budget?.at) parts.push(`as of ${budget.at}`);
  lines.push(parts.join(', '));
  return lines.join('\n');
}

function describeEvent(event: TaskEvent): string {
  const parts: string[] = [event.kind];
  if (event.status) parts.push(event.status);
  const head = parts.join(' ');
  const project = event.projectKey ? `${projectLabel(event.projectKey)}: ` : '';
  return event.summary
    ? `${project}${head}: ${clipOutputTail(event.summary, 300)}`
    : `${project}${head}`;
}
