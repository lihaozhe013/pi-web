/**
 * SQLite storage for the serial task queue.
 *
 * This is the only module in `lib/tasks` that contains SQL. The queue
 * controller composes these methods; every state guard that must survive a race
 * is inside a statement here, so a stale caller cannot win a claim it lost.
 *
 * The database lives at `<agentDir>/pie-tasks.db`: next to Pie's other state and
 * never inside a user's repository. `DatabaseSync` comes from Node's built-in
 * `node:sqlite`, so both storage and the CLI need no extra dependency.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { getAgentDir } from '../session-reader';
import type {
  PendingQuestion,
  QueueState,
  QueueStateRecord,
  TaskRecord,
  TaskRunRecord,
  TaskSettleInput,
  TaskStatus
} from './types';

export const TASK_DATABASE_FILE = 'pie-tasks.db';

/** How many finished runs the board keeps in its history payload. */
export const TASK_RUN_HISTORY_LIMIT = 50;

type Row = Record<string, unknown>;

interface TaskRowInsert {
  title: string;
  description: string | null;
  cwd: string;
  rank: number;
  allowAskUser: boolean | null;
  verifyCommands: string[] | null;
  autoCommit: boolean | null;
  now: string;
}

export interface TaskFieldUpdate {
  title?: string;
  description?: string | null;
  cwd?: string;
  allowAskUser?: boolean | null;
  verifyCommands?: string[] | null;
  autoCommit?: boolean | null;
  sessionId?: string | null;
  claimedToken?: string | null;
  pendingQuestion?: PendingQuestion | null;
  attempts?: number;
  rank?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function nullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Number(value) !== 0;
}

function booleanOrNull(value: boolean | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value ? 1 : 0;
}

function parseCommands(value: unknown): string[] | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : null;
  } catch {
    return null;
  }
}

function parseQuestion(value: unknown): PendingQuestion | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as PendingQuestion;
    return parsed && typeof parsed.question === 'string' && typeof parsed.requestId === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function serialize(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function taskFromRow(row: Row): TaskRecord {
  return {
    id: Number(row.id),
    title: String(row.title),
    description: row.description === null ? null : String(row.description),
    status: String(row.status) as TaskStatus,
    rank: Number(row.rank),
    cwd: String(row.cwd),
    allowAskUser: nullableBoolean(row.allow_ask_user),
    verifyCommands: parseCommands(row.verify_commands),
    autoCommit: nullableBoolean(row.auto_commit),
    sessionId: row.session_id === null ? null : String(row.session_id),
    claimedToken: row.claimed_token === null ? null : String(row.claimed_token),
    pendingQuestion: parseQuestion(row.pending_question),
    attempts: Number(row.attempts),
    resultSummary: row.result_summary === null ? null : String(row.result_summary),
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    verifyOutput: row.verify_output === null ? null : String(row.verify_output),
    commitSha: row.commit_sha === null ? null : String(row.commit_sha),
    runStartedAt: row.run_started_at === null ? null : String(row.run_started_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    finishedAt: row.finished_at === null ? null : String(row.finished_at)
  };
}

function runFromRow(row: Row): TaskRunRecord {
  return {
    id: Number(row.id),
    taskId: Number(row.task_id),
    attempt: Number(row.attempt),
    status: String(row.status) as TaskStatus,
    sessionId: row.session_id === null ? null : String(row.session_id),
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    verifyExit: row.verify_exit === null ? null : Number(row.verify_exit),
    outputTail: row.output_tail === null ? null : String(row.output_tail),
    commitSha: row.commit_sha === null ? null : String(row.commit_sha),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at === null ? null : String(row.finished_at)
  };
}

function queueStateFromRow(row: Row): QueueStateRecord {
  return {
    state: String(row.state) as QueueState,
    pausedReason: row.paused_reason === null ? null : String(row.paused_reason),
    activeTaskId: row.active_task_id === null ? null : Number(row.active_task_id),
    updatedAt: String(row.updated_at)
  };
}

const MIGRATIONS: Array<(db: DatabaseSync) => void> = [
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        title            TEXT NOT NULL,
        description      TEXT,
        status           TEXT NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING','IN_PROGRESS','DONE','BLOCKED','FAILED')),
        rank             INTEGER NOT NULL,
        cwd              TEXT NOT NULL,
        allow_ask_user   INTEGER,
        verify_commands  TEXT,
        auto_commit      INTEGER,
        session_id       TEXT,
        claimed_token    TEXT,
        pending_question TEXT,
        attempts         INTEGER NOT NULL DEFAULT 0,
        result_summary   TEXT,
        exit_code        INTEGER,
        verify_output    TEXT,
        commit_sha       TEXT,
        run_started_at   DATETIME,
        created_at       DATETIME NOT NULL,
        updated_at       DATETIME NOT NULL,
        finished_at      DATETIME
      );

      CREATE INDEX IF NOT EXISTS tasks_queue ON tasks (status, rank, id);

      CREATE TABLE IF NOT EXISTS task_runs (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        attempt        INTEGER NOT NULL,
        status         TEXT NOT NULL,
        session_id     TEXT,
        exit_code      INTEGER,
        verify_exit    INTEGER,
        output_tail    TEXT,
        commit_sha     TEXT,
        started_at     DATETIME NOT NULL,
        finished_at    DATETIME
      );

      CREATE TABLE IF NOT EXISTS queue_state (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        state           TEXT NOT NULL,
        paused_reason   TEXT,
        active_task_id  INTEGER,
        updated_at      DATETIME NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO queue_state (id, state, paused_reason, active_task_id, updated_at)
       VALUES (1, 'IDLE', NULL, NULL, ?)
       ON CONFLICT(id) DO NOTHING`
    ).run(nowIso());
  }
];

export class TaskStore {
  readonly path: string;
  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  constructor(path: string) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA synchronous = NORMAL');
    const requested = path === ':memory:' ? 'memory' : 'wal';
    let mode = 'unknown';
    try {
      const row = this.db.prepare(`PRAGMA journal_mode = ${requested}`).get() as Row | undefined;
      mode = row ? String(row.journal_mode).toLowerCase() : 'unknown';
    } catch (error) {
      console.warn('[pie] task database could not enable WAL:', error);
    }
    if (requested === 'wal' && mode !== 'wal') {
      try {
        const row = this.db.prepare('PRAGMA journal_mode = delete').get() as Row | undefined;
        mode = row ? String(row.journal_mode).toLowerCase() : 'unknown';
      } catch {
        // Keep the default journal mode.
      }
      console.warn(
        `[pie] task database WAL unavailable (journal_mode is ${mode}); continuing without it`
      );
    }
    this.migrate();
  }

  get journalMode(): string {
    const row = this.db.prepare('PRAGMA journal_mode').get() as Row | undefined;
    return row ? String(row.journal_mode).toLowerCase() : 'unknown';
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed.
    }
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as Row | undefined;
    let version = row ? Number(row.user_version) : 0;
    for (let index = version; index < MIGRATIONS.length; index++) {
      this.transaction(() => {
        MIGRATIONS[index](this.db);
        this.db.exec(`PRAGMA user_version = ${index + 1}`);
      });
      version = index + 1;
    }
  }

  /**
   * Run `body` inside one transaction. `BEGIN IMMEDIATE` takes the write lock at
   * the start, so a concurrent process cannot interleave a claim between the
   * guard and the update. Nested calls join the outer transaction.
   */
  transaction<T>(body: () => T): T {
    if (this.transactionDepth > 0) {
      this.transactionDepth += 1;
      try {
        return body();
      } finally {
        this.transactionDepth -= 1;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth = 1;
    try {
      const result = body();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // The transaction may already be gone; the original error is what matters.
      }
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
  }

  // ---------------------------------------------------------------- queue state

  getQueueState(): QueueStateRecord {
    const row = this.db.prepare('SELECT * FROM queue_state WHERE id = 1').get() as Row | undefined;
    if (!row) {
      return { state: 'IDLE', pausedReason: null, activeTaskId: null, updatedAt: nowIso() };
    }
    return queueStateFromRow(row);
  }

  setQueueState(
    patch: Partial<Pick<QueueStateRecord, 'state' | 'pausedReason' | 'activeTaskId'>>
  ): QueueStateRecord {
    const current = this.getQueueState();
    const next = {
      state: patch.state ?? current.state,
      pausedReason: patch.pausedReason !== undefined ? patch.pausedReason : current.pausedReason,
      activeTaskId: patch.activeTaskId !== undefined ? patch.activeTaskId : current.activeTaskId
    };
    this.db
      .prepare(
        `UPDATE queue_state SET state = ?, paused_reason = ?, active_task_id = ?, updated_at = ?
         WHERE id = 1`
      )
      .run(next.state, next.pausedReason, next.activeTaskId, nowIso());
    return this.getQueueState();
  }

  // --------------------------------------------------------------------- tasks

  listTasks(): TaskRecord[] {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY rank, id').all() as Row[];
    return rows.map(taskFromRow);
  }

  getTask(id: number): TaskRecord | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    return row ? taskFromRow(row) : null;
  }

  pendingTasks(): TaskRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE status = 'PENDING' ORDER BY rank, id`)
      .all() as Row[];
    return rows.map(taskFromRow);
  }

  inProgressTask(): TaskRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM tasks WHERE status = 'IN_PROGRESS' ORDER BY id LIMIT 1`)
      .get() as Row | undefined;
    return row ? taskFromRow(row) : null;
  }

  insertTask(input: TaskRowInsert): TaskRecord {
    const result = this.db
      .prepare(
        `INSERT INTO tasks (title, description, status, rank, cwd, allow_ask_user,
                            verify_commands, auto_commit, created_at, updated_at)
         VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.title,
        input.description,
        input.rank,
        input.cwd,
        booleanOrNull(input.allowAskUser),
        serialize(input.verifyCommands),
        booleanOrNull(input.autoCommit),
        input.now,
        input.now
      );
    const task = this.getTask(Number(result.lastInsertRowid));
    if (!task) throw new Error('the task row disappeared after insert');
    return task;
  }

  nextRank(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(rank), 0) AS rank FROM tasks').get() as Row;
    return Number(row.rank) + 10;
  }

  /**
   * Update editable fields, refusing a running task in the statement itself.
   * Returns null when the guard rejected the write.
   */
  updateTaskFields(id: number, fields: TaskFieldUpdate): TaskRecord | null {
    const assignments: string[] = [];
    const values: Array<string | number | null> = [];
    const push = (column: string, value: string | number | null) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if (fields.title !== undefined) push('title', fields.title);
    if (fields.description !== undefined) push('description', fields.description);
    if (fields.cwd !== undefined) push('cwd', fields.cwd);
    if (fields.allowAskUser !== undefined) push('allow_ask_user', booleanOrNull(fields.allowAskUser));
    if (fields.verifyCommands !== undefined)
      push('verify_commands', serialize(fields.verifyCommands));
    if (fields.autoCommit !== undefined) push('auto_commit', booleanOrNull(fields.autoCommit));
    if (fields.rank !== undefined) push('rank', fields.rank);
    if (assignments.length === 0) return this.getTask(id);

    push('updated_at', nowIso());
    const result = this.db
      .prepare(
        `UPDATE tasks SET ${assignments.join(', ')}
         WHERE id = ? AND status <> 'IN_PROGRESS'`
      )
      .run(...values, id);
    return Number(result.changes) === 1 ? this.getTask(id) : null;
  }

  /** Store the session id of the current attempt without touching the lock guard. */
  attachSession(id: number, sessionId: string): void {
    this.db
      .prepare('UPDATE tasks SET session_id = ?, updated_at = ? WHERE id = ?')
      .run(sessionId, nowIso(), id);
  }

  setPendingQuestion(id: number, question: PendingQuestion | null): void {
    this.db
      .prepare('UPDATE tasks SET pending_question = ?, updated_at = ? WHERE id = ?')
      .run(serialize(question), nowIso(), id);
  }

  deleteTask(id: number): boolean {
    const result = this.db
      .prepare(`DELETE FROM tasks WHERE id = ? AND status <> 'IN_PROGRESS'`)
      .run(id);
    return Number(result.changes) === 1;
  }

  /** Rewrite the pending segment as 10, 20, 30, ... inside one transaction. */
  rewritePendingRanks(orderedIds: number[]): void {
    this.transaction(() => {
      const statement = this.db.prepare(
        `UPDATE tasks SET rank = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'`
      );
      const now = nowIso();
      orderedIds.forEach((id, index) => {
        statement.run((index + 1) * 10, now, id);
      });
    });
  }

  /**
   * Claim the next pending task. The whole operation is one `BEGIN IMMEDIATE`
   * transaction: assert that no row is running, then flip the lowest
   * rank/id pending row while it is still pending.
   *
   * A missing pending row is not an error. A running row is: the loop should
   * never reach this point with one, and continuing would run two agents.
   */
  claimNextPending(token: string, sessionId: string): TaskRecord | null {
    return this.transaction(() => {
      const running = this.db
        .prepare(`SELECT id FROM tasks WHERE status = 'IN_PROGRESS' LIMIT 1`)
        .get() as Row | undefined;
      if (running) throw new Error(`task ${String(running.id)} is already in progress`);

      const candidate = this.db
        .prepare(
          `SELECT id FROM tasks WHERE status = 'PENDING' ORDER BY rank, id LIMIT 1`
        )
        .get() as Row | undefined;
      if (!candidate) return null;

      const id = Number(candidate.id);
      const now = nowIso();
      const result = this.db
        .prepare(
          `UPDATE tasks
              SET status = 'IN_PROGRESS', claimed_token = ?, session_id = ?, attempts = attempts + 1,
                  pending_question = NULL, result_summary = NULL, exit_code = NULL,
                  verify_output = NULL, commit_sha = NULL, finished_at = NULL,
                  run_started_at = ?, updated_at = ?
            WHERE id = ? AND status = 'PENDING'`
        )
        .run(token, sessionId, now, now, id);
      if (Number(result.changes) !== 1) {
        throw new Error(`task ${id} could not be claimed`);
      }
      return taskFromRow(this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row);
    });
  }

  /**
   * Write a terminal state, its run record, and the queue state in one
   * transaction. The task update only applies while the caller still owns the
   * claim, so a late writer cannot overwrite a newer attempt.
   */
  settleTask(id: number, token: string, input: TaskSettleInput): TaskRecord | null {
    return this.transaction(() => {
      const current = this.getTask(id);
      if (!current || current.claimedToken !== token || current.status !== 'IN_PROGRESS') {
        return null;
      }
      const now = nowIso();
      const updated = this.db
        .prepare(
          `UPDATE tasks
              SET status = ?, result_summary = ?, exit_code = ?, verify_output = ?,
                  commit_sha = ?, claimed_token = NULL, pending_question = NULL,
                  finished_at = ?, updated_at = ?
            WHERE id = ? AND status = 'IN_PROGRESS' AND claimed_token = ?`
        )
        .run(
          input.status,
          input.resultSummary,
          input.exitCode,
          input.verifyOutput ?? null,
          input.commitSha ?? null,
          now,
          now,
          id,
          token
        );
      if (Number(updated.changes) !== 1) return null;

      this.db
        .prepare(
          `INSERT INTO task_runs (task_id, attempt, status, session_id, exit_code, verify_exit,
                                 output_tail, commit_sha, started_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          current.attempts,
          input.status,
          input.sessionId,
          input.exitCode,
          input.verifyExit ?? null,
          input.outputTail ?? null,
          input.commitSha ?? null,
          current.runStartedAt ?? now,
          now
        );

      if (input.queueState) {
        this.setQueueState(input.queueState);
      }
      return this.getTask(id);
    });
  }

  listRuns(limit = TASK_RUN_HISTORY_LIMIT): TaskRunRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM task_runs ORDER BY id DESC LIMIT ?')
      .all(limit) as Row[];
    return rows.map(runFromRow);
  }

  listRunsForTask(taskId: number): TaskRunRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM task_runs WHERE task_id = ? ORDER BY id')
      .all(taskId) as Row[];
    return rows.map(runFromRow);
  }

  markTaskDone(id: number, summary: string | null): TaskRecord | null {
    const now = nowIso();
    const result = this.db
      .prepare(
        `UPDATE tasks SET status = 'DONE', result_summary = ?, claimed_token = NULL,
                          pending_question = NULL, finished_at = ?, updated_at = ?
          WHERE id = ? AND status <> 'IN_PROGRESS'`
      )
      .run(summary, now, now, id);
    return Number(result.changes) === 1 ? this.getTask(id) : null;
  }

  retryTask(id: number): TaskRecord | null {
    const now = nowIso();
    const result = this.db
      .prepare(
        `UPDATE tasks SET status = 'PENDING', result_summary = NULL, exit_code = NULL,
                          verify_output = NULL, commit_sha = NULL, finished_at = NULL,
                          claimed_token = NULL, pending_question = NULL, updated_at = ?
          WHERE id = ? AND status IN ('BLOCKED','FAILED')`
      )
      .run(now, id);
    return Number(result.changes) === 1 ? this.getTask(id) : null;
  }

  /**
   * At start-up, a row left running belongs to a child that died with the old
   * server. It never becomes DONE: the run did not survive.
   */
  recoverInterrupted(summary: string): TaskRecord[] {
    const now = nowIso();
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE status = 'IN_PROGRESS'`)
      .all() as Row[];
    if (rows.length === 0) return [];
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'BLOCKED', result_summary = ?, claimed_token = NULL,
                            pending_question = NULL, finished_at = ?, updated_at = ?
            WHERE status = 'IN_PROGRESS'`
        )
        .run(summary, now, now);
      this.db
        .prepare(`UPDATE queue_state SET state = 'PAUSED', paused_reason = ?, active_task_id = NULL, updated_at = ? WHERE id = 1`)
        .run(summary, now);
    });
    return rows.map(taskFromRow);
  }

  /** Whether a session id belongs to a task row the queue still owns. */
  taskForSession(sessionId: string): TaskRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM tasks WHERE session_id = ? AND status = 'IN_PROGRESS' LIMIT 1`)
      .get(sessionId) as Row | undefined;
    return row ? taskFromRow(row) : null;
  }
}

export function newClaimToken(): string {
  return randomUUID();
}

export function defaultTaskDatabasePath(agentDir: string = getAgentDir()): string {
  return join(agentDir, TASK_DATABASE_FILE);
}

declare global {
  var __pieTaskStore: TaskStore | undefined;
  var __pieTaskStorePath: string | undefined;
}

/**
 * The per-process store. Route handlers are bundled separately and hot reload
 * re-evaluates modules, so a single `globalThis` instance keeps one connection
 * to one database.
 */
export function getTaskStore(path: string = defaultTaskDatabasePath()): TaskStore {
  if (
    globalThis.__pieTaskStore &&
    globalThis.__pieTaskStorePath === path &&
    existsSync(path)
  ) {
    return globalThis.__pieTaskStore;
  }
  globalThis.__pieTaskStore?.close();
  globalThis.__pieTaskStore = new TaskStore(path);
  globalThis.__pieTaskStorePath = path;
  return globalThis.__pieTaskStore;
}

/** Only tests reset this; a running server keeps one store for its lifetime. */
export function resetTaskStore(): void {
  globalThis.__pieTaskStore?.close();
  globalThis.__pieTaskStore = undefined;
  globalThis.__pieTaskStorePath = undefined;
}
