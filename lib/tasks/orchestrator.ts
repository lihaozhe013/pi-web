/**
 * The one loop that drives the queue: claim → run → gate → commit → settle.
 *
 * A per-process singleton (a `globalThis` key) plus one `proper-lockfile` lock at
 * `<agentDir>/pie-tasks.lock` keeps two servers, a second checkout, or a stale
 * process from driving the same queue. The loop is strictly serial: it claims one
 * task, waits for its child, and only then looks at the next one. Nothing here
 * calls an LLM to decide anything.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import lockfile from 'proper-lockfile';
import { getAgentDir } from '../session-reader';
import { getProjectTrustStatus } from '../project-trust';
import { markTaskSessionActive, clearTaskSessionActive } from './active-sessions';
import { commitMessageFor, readTaskConfig, resolveTaskPolicy } from './config';
import { captureGitBaseline, commitRunChanges } from './git';
import { runVerificationGate } from './gate';
import { buildTaskPrompt } from './prompt';
import { TaskQueue, clipOutputTail, TaskLockedError } from './queue';
import { getTaskStore, type TaskStore } from './store';
import { startTaskRun, type TaskRunHandle, type TaskRunOutcome } from './runner';
import { DEFAULT_GRACE_MS } from './rpc-session';
import type { spawn } from 'node:child_process';
import type {
  OrchestratorStatus,
  TaskActivity,
  TaskAnswerInput,
  TaskConfig,
  TaskRecord
} from './types';

export type TaskNotificationKind = 'complete' | 'done' | 'blocked' | 'failed' | 'question';

export interface TaskNotification {
  kind: TaskNotificationKind;
  task: Pick<TaskRecord, 'id' | 'title'> | null;
  reason?: string;
}

export type TaskNotifier = (notification: TaskNotification) => void | Promise<void>;

export class OrchestratorConflictError extends Error {
  readonly code: string;
  constructor(code: 'already_running' | 'not_running' | 'no_pending_question', message: string) {
    super(message);
    this.name = 'OrchestratorConflictError';
    this.code = code;
  }
}

export interface TaskOrchestratorOptions {
  store?: TaskStore;
  agentDir?: string;
  queue?: TaskQueue;
  lockPath?: string;
  notifier?: TaskNotifier;
  askUserExtensionPath?: string | null;
  /** Tests replace the child process and the clock. */
  childCommand?: Parameters<typeof startTaskRun>[0]['childCommand'];
  spawnFn?: typeof spawn;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  graceMs?: number;
}

export const TASK_LOCK_FILE = 'pie-tasks.lock';

function defaultAskUserExtensionPath(): string | null {
  const candidates: string[] = [];
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(dirname(moduleDir), 'ask-user-cli-extension.ts'));
  } catch {
    // `import.meta.url` is not always available in the compiled server chunk.
  }
  candidates.push(join(process.cwd(), 'lib', 'ask-user-cli-extension.ts'));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function defaultNotifier(notification: TaskNotification): Promise<void> {
  try {
    const { notifyTaskEvent } = await import('../web-push');
    await notifyTaskEvent(notification);
  } catch {
    // Notifications are best-effort; the queue does not depend on them.
  }
}

interface ActiveRun {
  taskId: number;
  token: string;
  handle: TaskRunHandle;
}

export class TaskOrchestrator {
  readonly queue: TaskQueue;
  private readonly agentDir: string;
  private readonly lockPath: string;
  private readonly notifier: TaskNotifier;
  private readonly options: TaskOrchestratorOptions;

  private loop: Promise<void> | null = null;
  private starting = false;
  private stopping = false;
  private releaseLock: (() => Promise<void>) | null = null;
  private activeRun: ActiveRun | null = null;
  private currentActivity: TaskActivity | null = null;

  constructor(options: TaskOrchestratorOptions = {}) {
    this.options = options;
    this.agentDir = options.agentDir ?? getAgentDir();
    const store = options.store ?? getTaskStore();
    this.queue = options.queue ?? new TaskQueue(store);
    this.lockPath = options.lockPath ?? join(this.agentDir, TASK_LOCK_FILE);
    this.notifier = options.notifier ?? defaultNotifier;
  }

  get running(): boolean {
    return this.loop !== null;
  }

  config(): TaskConfig {
    return readTaskConfig(this.agentDir);
  }

  status(): OrchestratorStatus {
    const state = this.queue.status(this.running);
    return { ...state, activity: this.activeRun ? this.currentActivity : null };
  }

  /** The live tail of the active task, or '' when nothing runs. */
  output(taskId: number): string {
    return this.activeRun?.taskId === taskId ? (this.activeRun.handle.output() ?? '') : '';
  }

  private notify(notification: TaskNotification): void {
    void Promise.resolve()
      .then(() => this.notifier(notification))
      .catch(() => {
        // A failed notification never changes a task outcome.
      });
  }

  /**
   * Acquire the lock, recover what the last process left running, and drain the
   * queue. Resolves when the loop stops; routes start it without awaiting.
   */
  start(): Promise<void> {
    if (this.starting || this.loop) {
      return Promise.reject(
        new OrchestratorConflictError('already_running', 'The queue is already running')
      );
    }
    this.starting = true;
    const loop = this.runLoop().finally(() => {
      this.starting = false;
      this.loop = null;
      this.currentActivity = null;
      const release = this.releaseLock;
      this.releaseLock = null;
      if (release) void release().catch(() => {});
    });
    this.loop = loop;
    return loop;
  }

  private async acquireLock(): Promise<void> {
    try {
      const release = await lockfile.lock(this.lockPath, {
        realpath: false,
        stale: 30_000,
        update: 10_000
      });
      this.releaseLock = async () => {
        await release();
      };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 'ELOCKED') {
        throw new OrchestratorConflictError(
          'already_running',
          'Another Pie process is driving the task queue'
        );
      }
      throw error;
    }
  }

  private async runLoop(): Promise<void> {
    await this.acquireLock();
    this.stopping = false;
    const recovered = this.queue.recoverInterrupted();
    if (recovered.length > 0) {
      this.notify({
        kind: 'blocked',
        task: recovered[recovered.length - 1],
        reason: 'orchestrator restarted during the run'
      });
      // A recovered row needs a person: recovery already paused the queue, and
      // clearing that pause here would resume work nobody reviewed.
      return;
    }
    this.queue.setQueueState({ state: 'RUNNING', pausedReason: null, activeTaskId: null });

    try {
      while (!this.stopping) {
        const state = this.queue.getQueueState();
        if (state.state === 'PAUSED') break;
        const sessionId = randomUUID();
        let task: TaskRecord | null;
        try {
          task = this.queue.claimNext(sessionId);
        } catch (error) {
          // The serial invariant was violated; refuse to run two agents.
          const reason = error instanceof Error ? error.message : String(error);
          this.queue.setQueueState({ state: 'PAUSED', pausedReason: reason, activeTaskId: null });
          this.notify({ kind: 'failed', task: null, reason });
          break;
        }
        if (!task) {
          this.queue.setQueueState({ state: 'IDLE', activeTaskId: null });
          this.notify({ kind: 'complete', task: null });
          break;
        }
        // An abort or pause that arrived between the state check and the claim
        // must not let the task run behind the person's back.
        const afterClaim = this.queue.getQueueState();
        if (afterClaim.state === 'PAUSED') {
          try {
            this.queue.settle(task.id, task.claimedToken ?? '', {
              status: 'BLOCKED',
              resultSummary: 'aborted by user',
              exitCode: null,
              sessionId: task.sessionId,
              queueState: {
                state: 'PAUSED',
                pausedReason: afterClaim.pausedReason ?? 'aborted by user',
                activeTaskId: null
              }
            });
          } catch {
            // The task was already settled; the pause still stops the loop.
          }
          break;
        }
        this.queue.setQueueState({ state: 'RUNNING', activeTaskId: task.id });
        let outcome: 'done' | 'stopped';
        try {
          outcome = await this.executeTask(task);
        } catch (error) {
          // A thrown error must never leave a row IN_PROGRESS with no child.
          const reason = error instanceof Error ? error.message : String(error);
          try {
            this.queue.settle(task.id, task.claimedToken ?? '', {
              status: 'FAILED',
              resultSummary: reason.slice(0, 2_000),
              exitCode: null,
              sessionId: task.sessionId,
              queueState: { state: 'PAUSED', pausedReason: reason, activeTaskId: null }
            });
          } catch {
            // Already settled by the run itself.
          }
          this.notify({ kind: 'failed', task, reason });
          break;
        }
        if (outcome === 'done') continue;
        break;
      }
    } finally {
      this.stopping = false;
    }
  }

  /** Resolve with the terminal status this attempt settled as. */
  private async executeTask(task: TaskRecord): Promise<'done' | 'stopped'> {
    const token = task.claimedToken;
    const sessionId = task.sessionId;
    if (!token || !sessionId) {
      throw new Error('the claimed task is missing its token or session id');
    }
    const config = this.config();
    const policy = resolveTaskPolicy(config, task);
    // An unreadable trust store means "not trusted": an unattended run must not
    // be the first thing that executes a repository's local extensions.
    const trust = (() => {
      try {
        return getProjectTrustStatus(task.cwd, this.agentDir);
      } catch {
        return { requiresTrust: true, trusted: false };
      }
    })();
    const askUserExtensionPath = policy.allowAskUser
      ? (this.options.askUserExtensionPath ?? defaultAskUserExtensionPath())
      : null;

    markTaskSessionActive(sessionId);
    this.currentActivity = null;
    const baseline = policy.autoCommit ? await captureGitBaseline(task.cwd) : null;

    const handle = startTaskRun({
      taskId: task.id,
      prompt: buildTaskPrompt({
        task,
        verifyCommands: policy.verifyCommands,
        allowAskUser: policy.allowAskUser
      }),
      cwd: task.cwd,
      sessionId,
      model: policy.model,
      sessionName: `T${task.id} ${task.title}`.replace(/\s+/g, ' ').slice(0, 160),
      projectTrusted: trust.requiresTrust && trust.trusted,
      askUserExtensionPath,
      timeoutMs: policy.taskTimeoutMs,
      childCommand: this.options.childCommand,
      spawnFn: this.options.spawnFn,
      platform: this.options.platform,
      env: this.options.env,
      now: this.options.now,
      onActivity: (activity) => {
        this.currentActivity = activity;
      },
      onQuestion: (question) => {
        try {
          this.queue.setPendingQuestion(task.id, question);
        } catch (error) {
          console.warn('[pie] could not persist the task question:', error);
        }
        if (question) {
          this.notify({ kind: 'question', task, reason: question.question });
        }
      }
    });

    this.activeRun = { taskId: task.id, token, handle };
    let outcome: TaskRunOutcome;
    try {
      outcome = await handle.result;
    } finally {
      this.activeRun = null;
      this.currentActivity = null;
      clearTaskSessionActive(sessionId);
    }

    const settle = (input: Parameters<TaskQueue['settle']>[2]) => {
      try {
        this.queue.settle(task.id, token, input);
      } catch (error) {
        if (error instanceof TaskLockedError) return;
        throw error;
      }
    };

    if (outcome.status === 'aborted') {
      settle({
        status: 'BLOCKED',
        resultSummary: 'aborted by user',
        exitCode: outcome.exitCode,
        sessionId,
        outputTail: clipOutputTail(outcome.outputTail),
        queueState: { state: 'PAUSED', pausedReason: 'aborted by user', activeTaskId: null }
      });
      this.notify({ kind: 'blocked', task, reason: 'aborted by user' });
      return 'stopped';
    }

    if (outcome.status === 'timeout') {
      settle({
        status: 'FAILED',
        resultSummary: outcome.summary,
        exitCode: outcome.exitCode,
        sessionId,
        outputTail: clipOutputTail(outcome.outputTail),
        queueState: { state: 'PAUSED', pausedReason: outcome.summary, activeTaskId: null }
      });
      this.notify({ kind: 'failed', task, reason: outcome.summary });
      return 'stopped';
    }

    if (outcome.status === 'failed') {
      settle({
        status: 'FAILED',
        resultSummary: outcome.summary,
        exitCode: outcome.exitCode,
        sessionId,
        outputTail: clipOutputTail(outcome.outputTail),
        queueState: { state: 'PAUSED', pausedReason: outcome.summary, activeTaskId: null }
      });
      this.notify({ kind: 'failed', task, reason: outcome.summary });
      return 'stopped';
    }

    // The agent exited cleanly. The gate decides whether the work counts.
    const gate = await runVerificationGate(policy.verifyCommands, {
      cwd: task.cwd,
      timeoutMs: policy.verifyTimeoutMs,
      platform: this.options.platform,
      spawnFn: this.options.spawnFn,
      env: this.options.env
    });
    if (!gate.ok) {
      const reason = gate.timedOut
        ? `Verification timed out: ${gate.failedCommand ?? 'unknown command'}`
        : `Verification failed (exit ${gate.exitCode ?? 'null'}): ${gate.failedCommand ?? 'unknown command'}`;
      settle({
        status: 'BLOCKED',
        resultSummary: clipOutputTail(`${reason}\n\n${outcome.summary}`, 2_000),
        exitCode: outcome.exitCode,
        sessionId,
        verifyExit: gate.exitCode,
        verifyOutput: clipOutputTail(gate.output),
        outputTail: clipOutputTail(outcome.outputTail),
        queueState: { state: 'PAUSED', pausedReason: reason, activeTaskId: null }
      });
      this.notify({ kind: 'blocked', task, reason });
      return 'stopped';
    }

    let commitNote: string | null = null;
    let commitSha: string | null = null;
    if (policy.autoCommit && baseline) {
      const commit = await commitRunChanges(
        task.cwd,
        baseline,
        commitMessageFor(policy.commitMessage, task),
        { spawnFn: this.options.spawnFn, env: this.options.env }
      );
      if (commit.status === 'committed') {
        commitSha = commit.sha ?? null;
        commitNote = commitSha ? `Committed ${commitSha.slice(0, 7)}` : 'Committed';
      } else if (commit.status === 'failed') {
        commitNote = `Verified, not committed: ${commit.reason ?? 'git failed'}`;
      } else {
        commitNote = 'Verified, no changes to commit';
      }
    }
    const verifiedNote =
      policy.verifyCommands.length > 0
        ? `Verification passed (${policy.verifyCommands.length} command${
            policy.verifyCommands.length === 1 ? '' : 's'
          })`
        : null;
    const summary = [outcome.summary, verifiedNote, commitNote].filter(Boolean).join('\n\n');

    settle({
      status: 'DONE',
      resultSummary: clipOutputTail(summary, 2_000),
      exitCode: outcome.exitCode,
      sessionId,
      verifyExit: 0,
      commitSha,
      outputTail: clipOutputTail(outcome.outputTail),
      // State is left as it is: a pause requested during the run must survive
      // the settle, and the loop's next iteration is what reads it.
      queueState: { activeTaskId: null }
    });
    this.notify({ kind: 'done', task, reason: commitNote ?? verifiedNote ?? undefined });
    return 'done';
  }

  /** Take effect between tasks, never mid-run. */
  async pause(reason?: string): Promise<OrchestratorStatus> {
    const state = this.queue.getQueueState();
    if (state.state === 'PAUSED') return this.status();
    this.queue.setQueueState({
      state: 'PAUSED',
      pausedReason: reason ?? 'paused by user',
      activeTaskId: state.activeTaskId
    });
    return this.status();
  }

  async resume(): Promise<OrchestratorStatus> {
    if (this.starting || this.loop) {
      throw new OrchestratorConflictError('already_running', 'The queue is already running');
    }
    this.queue.setQueueState({ state: 'RUNNING', pausedReason: null });
    void this.start().catch((error) => {
      console.warn('[pie] the task queue could not resume:', error);
      this.queue.setQueueState({
        state: 'PAUSED',
        pausedReason: error instanceof Error ? error.message : String(error),
        activeTaskId: null
      });
    });
    return this.status();
  }

  /**
   * Stop the running task for real. The run settles as BLOCKED and the loop
   * pauses, because an abort usually means the task itself is wrong.
   */
  async abort(): Promise<OrchestratorStatus> {
    const active = this.activeRun;
    this.queue.setQueueState({ state: 'PAUSED', pausedReason: 'aborted by user' });
    if (active) {
      await active.handle.abort();
    }
    return this.status();
  }

  async answer(taskId: number, input: TaskAnswerInput): Promise<void> {
    const active = this.activeRun;
    const task = this.queue.getTask(taskId);
    if (!active || active.taskId !== taskId || !task.pendingQuestion) {
      throw new OrchestratorConflictError('no_pending_question', 'The task has no pending question');
    }
    await active.handle.answer(input);
  }

  /** Kill the active child and settle its task, so a restart leaves no zombie agent. */
  async shutdown(graceMs = DEFAULT_GRACE_MS): Promise<void> {
    this.stopping = true;
    const active = this.activeRun;
    if (active) {
      try {
        await active.handle.abort();
      } catch {
        // The child may already be gone.
      }
    }
    if (this.loop) {
      await Promise.race([
        this.loop.catch(() => {}),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, graceMs);
          timer.unref?.();
        })
      ]);
    }
    const release = this.releaseLock;
    this.releaseLock = null;
    if (release) await release().catch(() => {});
  }
}

declare global {
  var __pieTaskOrchestrator: TaskOrchestrator | undefined;
  var __pieTaskOrchestratorStore: TaskStore | undefined;
  var __pieTaskOrchestratorOptions: TaskOrchestratorOptions | undefined;
}

export function getTaskOrchestrator(options: TaskOrchestratorOptions = {}): TaskOrchestrator {
  if (globalThis.__pieTaskOrchestrator) return globalThis.__pieTaskOrchestrator;
  const orchestrator = new TaskOrchestrator(options);
  globalThis.__pieTaskOrchestrator = orchestrator;
  globalThis.__pieTaskOrchestratorOptions = options;
  return orchestrator;
}

/** Only tests reset this. */
export function resetTaskOrchestrator(): void {
  globalThis.__pieTaskOrchestrator = undefined;
  globalThis.__pieTaskOrchestratorOptions = undefined;
}

/** The orchestrator this process already created, without creating one. */
export function activeTaskOrchestrator(): TaskOrchestrator | null {
  return globalThis.__pieTaskOrchestrator ?? null;
}

/** Shutdown hook: kill the active child and settle its task as BLOCKED. */
export async function shutdownActiveTaskOrchestrator(): Promise<void> {
  const orchestrator = activeTaskOrchestrator();
  if (!orchestrator) return;
  await orchestrator.shutdown();
}
