/**
 * One task attempt: one Pi CLI child process, spoken to over Pi's documented RPC
 * records.
 *
 * The framing rules follow Pi's `docs/rpc.md`: split stdout on LF only (never a
 * line reader that also breaks on U+2028/U+2029), strip a preceding CR,
 * correlate commands by their `id`, read stdout continuously, and treat stderr
 * as diagnostics. The child is detached on POSIX so the whole tree can be killed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execPath, platform as processPlatform } from 'node:process';
import { randomUUID } from 'node:crypto';

/** Bounded in-memory tail of what the active task printed. */
export const TASK_TAIL_LIMIT = 64 * 1024;
export const TASK_STDERR_LIMIT = 4 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;
export const DEFAULT_GRACE_MS = 5_000;

export interface TaskChildCommand {
  command: string;
  args: string[];
}

export interface TaskChildCommandInput {
  cwd: string;
  sessionId: string;
  sessionName: string;
  /** True only when `lib/project-trust.ts` already trusts this directory. */
  projectTrusted: boolean;
  askUserExtensionPath?: string | null;
}

/**
 * The app root: where its own `node_modules` and the installed Pi CLI live.
 * `bin/pie.js` starts Next with the package directory as its working directory,
 * and a development run starts it at the checkout root, so the cwd is the
 * anchor. A module-relative fallback covers a launcher that changes that.
 */
function appRootCandidates(): string[] {
  const candidates = [process.cwd()];
  try {
    candidates.push(dirname(dirname(__filename)));
  } catch {
    // A bundled chunk has no useful `__filename`.
  }
  return candidates;
}

/** The CLI script shipped in this app's own `node_modules`, never a shell wrapper. */
export function resolvePiCliScript(): string | null {
  for (const root of appRootCandidates()) {
    const candidate = join(
      root,
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'dist',
      'bundle',
      'cli.js'
    );
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Build the child invocation. The CLI script runs through `process.execPath`, so
 * Windows needs no `.cmd` handling and a portable install resolves the same way
 * the chat runtime resolves its CLI (`lib/node-cli.ts` reasons the same way).
 */
export function buildTaskChildCommand(input: TaskChildCommandInput): TaskChildCommand {
  const script = resolvePiCliScript();
  if (!script) throw new Error('The installed Pi CLI could not be found');
  const args = [
    script,
    '--mode',
    'rpc',
    '--session-id',
    input.sessionId,
    '--name',
    input.sessionName,
    input.projectTrusted ? '--approve' : '--no-approve'
  ];
  if (input.askUserExtensionPath) args.push('-e', input.askUserExtensionPath);
  return { command: execPath, args };
}

export interface TaskRpcSessionOptions {
  command: TaskChildCommand;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  graceMs?: number;
  platform?: NodeJS.Platform;
  /** Injectable for tests. */
  spawnFn?: typeof spawn;
}

export type RpcRecordListener = (record: Record<string, unknown>) => void;

interface PendingCommand {
  resolve: (record: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** Keep only the last `limit` characters; the tail is all the board shows. */
export function appendToTail(current: string, text: string, limit = TASK_TAIL_LIMIT): string {
  const combined = current + text;
  return combined.length <= limit ? combined : combined.slice(combined.length - limit);
}

export class TaskRpcSession {
  private readonly options: TaskRpcSessionOptions;
  private child: ChildProcess | null = null;
  private buffer = '';
  private readonly pending = new Map<string, PendingCommand>();
  private readonly recordListeners = new Set<RpcRecordListener>();
  private readonly exitListeners = new Set<(info: { code: number | null; signal: string | null }) => void>();
  private settledWaiters: Array<{
    resolve: (value: { aborted: boolean }) => void;
    reject: (error: Error) => void;
  }> = [];
  private settledResult: { aborted: boolean } | null = null;
  private exitInfo: { code: number | null; signal: string | null } | null = null;
  private tail = '';
  private stderrTail = '';
  private stopRequested = false;
  private started = false;

  constructor(options: TaskRpcSessionOptions) {
    this.options = options;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get exitCode(): number | null {
    return this.exitInfo?.code ?? null;
  }

  get hasExited(): boolean {
    return this.exitInfo !== null;
  }

  /** True when this client asked the run to stop, not the child on its own. */
  get stopWasRequested(): boolean {
    return this.stopRequested;
  }

  get stderr(): string {
    return this.stderrTail;
  }

  getTail(): string {
    return this.tail;
  }

  start(): void {
    if (this.started) throw new Error('the task child was already started');
    this.started = true;
    const spawnFn = this.options.spawnFn ?? spawn;
    const isWindows = (this.options.platform ?? processPlatform) === 'win32';
    const child = spawnFn(this.options.command.command, this.options.command.args, {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !isWindows,
      windowsHide: true
    });
    this.child = child;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.consume(chunk));
    child.stderr?.on('data', (chunk: string) => {
      // Diagnostics are never protocol data.
      this.stderrTail = appendToTail(this.stderrTail, chunk, TASK_STDERR_LIMIT);
    });
    child.on('error', (error) => {
      this.failAll(new Error(`the task child failed: ${error.message}`));
    });
    child.on('close', (code, signal) => {
      this.exitInfo = { code: code ?? null, signal: signal ?? null };
      // Flush a final record that arrived without its trailing newline.
      if (this.buffer.trim()) {
        const rest = this.buffer;
        this.buffer = '';
        this.consume(`${rest}\n`);
      }
      this.failAll(new Error(`the task child exited (code ${code ?? 'null'})`));
      for (const listener of this.exitListeners) listener(this.exitInfo);
      this.exitListeners.clear();
    });
  }

  onRecord(listener: RpcRecordListener): () => void {
    this.recordListeners.add(listener);
    return () => this.recordListeners.delete(listener);
  }

  onExit(listener: (info: { code: number | null; signal: string | null }) => void): () => void {
    if (this.exitInfo) {
      listener(this.exitInfo);
      return () => {};
    }
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.trim()) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.stderrTail = appendToTail(this.stderrTail, `${line}\n`, TASK_STDERR_LIMIT);
      return;
    }
    if (record.type === 'response' && typeof record.id === 'string') {
      const pending = this.pending.get(record.id);
      if (pending) {
        this.pending.delete(record.id);
        clearTimeout(pending.timer);
        pending.resolve(record);
      }
    }
    if (record.type === 'agent_settled') {
      const aborted = record.aborted === true;
      this.settledResult = { aborted };
      const waiters = this.settledWaiters;
      this.settledWaiters = [];
      for (const waiter of waiters) waiter.resolve({ aborted });
    }
    for (const listener of this.recordListeners) {
      try {
        listener(record);
      } catch (error) {
        console.warn('[pie] a task record listener failed:', error);
      }
    }
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    const waiters = this.settledWaiters;
    this.settledWaiters = [];
    for (const waiter of waiters) waiter.reject(error);
  }

  private writeLine(line: string): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) {
      return Promise.reject(new Error('the task child is not running'));
    }
    const written = new Promise<void>((resolve, reject) => {
      stdin.write(line, 'utf8', (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    let unsubscribe: () => void = () => {};
    // A child that dies before the write flushes never calls back; the exit
    // listener is what keeps the queue from waiting on a dead pipe.
    const exited = new Promise<never>((_, reject) => {
      unsubscribe = this.onExit(() => reject(new Error('the task child exited')));
    });
    return Promise.race([written, exited]).finally(() => unsubscribe());
  }

  /**
   * Send one command. The returned promise resolves with the matching response;
   * the command timeout keeps a hung child from hanging the queue.
   */
  async send(
    command: Record<string, unknown>,
    timeoutMs = COMMAND_TIMEOUT_MS
  ): Promise<Record<string, unknown>> {
    if (this.exitInfo) throw new Error('the task child has exited');
    const id = typeof command.id === 'string' ? command.id : randomUUID();
    const payload = { ...command, id };
    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the task child did not answer ${String(command.type)}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
    });
    try {
      await this.writeLine(`${JSON.stringify(payload)}\n`);
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      throw error;
    }
    return response;
  }

  async prompt(message: string): Promise<Record<string, unknown>> {
    return this.send({ type: 'prompt', message });
  }

  /**
   * Write one record without waiting for a response. `extension_ui_response` has
   * no command response, and a dialog answer must not wait for one.
   */
  async sendRaw(record: Record<string, unknown>): Promise<void> {
    if (this.exitInfo) throw new Error('the task child has exited');
    await this.writeLine(`${JSON.stringify(record)}\n`);
  }

  /** Resolve when Pi will not continue this run automatically. */
  waitForSettled(): Promise<{ aborted: boolean }> {
    if (this.settledResult) return Promise.resolve(this.settledResult);
    if (this.exitInfo) {
      return Promise.reject(
        new Error(`the task child exited before settling (code ${this.exitInfo.code ?? 'null'})`)
      );
    }
    return new Promise((resolve, reject) => {
      this.settledWaiters.push({ resolve, reject });
    });
  }

  appendTail(text: string): void {
    this.tail = appendToTail(this.tail, text);
  }

  waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.exitInfo) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, timeoutMs);
      timer.unref?.();
      const unsubscribe = this.onExit(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** Ask the child to stop, then close its stdin, then wait. */
  async abort(): Promise<void> {
    this.stopRequested = true;
    if (!this.exitInfo) {
      try {
        await this.send({ type: 'abort' }, 10_000);
      } catch {
        // A child that cannot answer is killed below.
      }
    }
    await this.close();
  }

  /** Orderly shutdown: close stdin, give the child a grace period, then kill it. */
  async close(): Promise<void> {
    this.stopRequested = true;
    const child = this.child;
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {
      // Already closed.
    }
    const exited = await this.waitForExit(this.options.graceMs ?? DEFAULT_GRACE_MS);
    if (!exited) this.killTree();
  }

  /** Kill the whole process tree, not only the direct child. */
  killTree(): void {
    const child = this.child;
    if (!child?.pid || this.exitInfo) return;
    const isWindows = (this.options.platform ?? processPlatform) === 'win32';
    const spawnFn = this.options.spawnFn ?? spawn;
    if (isWindows) {
      try {
        const killer = spawnFn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true
        });
        killer.on('error', () => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already gone.
          }
        });
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // Already gone.
        }
      }
      return;
    }
    try {
      // The child is detached, so its pid is the process-group id.
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
}
