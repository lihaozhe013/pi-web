/**
 * Shared shapes of the serial task queue.
 *
 * These types cross every boundary the queue owns: the database row mapper, the
 * queue controller, the HTTP routes, and the browser board. Nothing here knows
 * about Pi; the runner and the RPC session add that.
 */

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED' | 'FAILED';

export type QueueState = 'IDLE' | 'RUNNING' | 'PAUSED';

/** A question asked by the running task's `ask_user` tool, kept across reloads. */
export interface PendingQuestion {
  /** The RPC request id the answer must repeat. */
  requestId: string;
  question: string;
  /** The offered options without the "write my own answer" sentinel. */
  options: string[];
  /** False while the child waits for the free-form follow-up `input` request. */
  awaitingInput: boolean;
  askedAt: string;
}

export interface TaskRecord {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  rank: number;
  cwd: string;
  /** Null means "use the queue default". */
  allowAskUser: boolean | null;
  verifyCommands: string[] | null;
  autoCommit: boolean | null;
  sessionId: string | null;
  claimedToken: string | null;
  pendingQuestion: PendingQuestion | null;
  attempts: number;
  resultSummary: string | null;
  exitCode: number | null;
  verifyOutput: string | null;
  commitSha: string | null;
  runStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface TaskRunRecord {
  id: number;
  taskId: number;
  attempt: number;
  status: TaskStatus;
  sessionId: string | null;
  exitCode: number | null;
  verifyExit: number | null;
  outputTail: string | null;
  commitSha: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface QueueStateRecord {
  state: QueueState;
  pausedReason: string | null;
  activeTaskId: number | null;
  updatedAt: string;
}

/** The model a task's child starts with; `null` keeps Pi's own default. */
export interface TaskModelSelection {
  provider: string;
  modelId: string;
}

export interface TaskConfig {
  /** Applies to the next task the queue starts, never to one already running. */
  model: TaskModelSelection | null;
  verifyCommands: string[];
  verifyTimeoutMs: number;
  taskTimeoutMs: number;
  allowAskUser: boolean;
  autoCommit: boolean;
  commitMessage: string;
}

/** The activity vocabulary the board shows; the browser translates it. */
export type TaskActivityKind = 'starting' | 'waiting' | 'thinking' | 'reading' | 'writing' | 'running';

export interface TaskActivity {
  taskId: number;
  kind: TaskActivityKind;
  /** A concrete detail such as a file name or a command. */
  detail: string | null;
  at: string;
}

export interface OrchestratorStatus {
  state: QueueState;
  pausedReason: string | null;
  activeTaskId: number | null;
  /** True while the process loop is executing, as opposed to the stored state. */
  running: boolean;
  activity: TaskActivity | null;
}

export interface TaskCreateInput {
  title: string;
  description?: string | null;
  cwd: string;
  allowAskUser?: boolean | null;
  verifyCommands?: string[] | null;
  autoCommit?: boolean | null;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string | null;
  cwd?: string;
  allowAskUser?: boolean | null;
  verifyCommands?: string[] | null;
  autoCommit?: boolean | null;
}

export interface TaskMoveAction {
  direction?: 'up' | 'down';
  position?: number;
}

export interface TaskAnswerInput {
  answer?: string;
  cancelled?: boolean;
}

export interface TaskSettleInput {
  status: TaskStatus;
  resultSummary: string | null;
  exitCode: number | null;
  sessionId: string | null;
  verifyOutput?: string | null;
  verifyExit?: number | null;
  commitSha?: string | null;
  outputTail?: string | null;
  queueState?: Partial<Pick<QueueStateRecord, 'state' | 'pausedReason' | 'activeTaskId'>>;
}
