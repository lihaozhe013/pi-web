/**
 * Optional auto-commit.
 *
 * Only what this run changed is committed. The baseline is captured before the
 * agent starts, and the commit stages the paths whose status differs from it, so
 * changes that were already in the working tree are left alone. The queue
 * commits; it never pushes, amends, or touches branches.
 */
import { spawn } from 'node:child_process';

export const GIT_OUTPUT_LIMIT = 4_000;

export interface GitBaseline {
  repoRoot: string;
  entries: Map<string, string>;
}

export interface CommitResult {
  status: 'committed' | 'skipped' | 'failed';
  sha?: string;
  reason?: string;
}

export interface GitOptions {
  spawnFn?: typeof spawn;
  env?: NodeJS.ProcessEnv;
}

interface GitRun {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: string[], options: GitOptions): Promise<GitRun> {
  const spawnFn = options.spawnFn ?? spawn;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawnFn('git', args, {
      cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ ok: false, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

function clip(text: string, limit = GIT_OUTPUT_LIMIT): string {
  return text.length <= limit ? text : `…${text.slice(text.length - limit)}`;
}

/**
 * Parse `git status --porcelain -z -uall` into path → status code. A rename or
 * copy entry carries the original path as the following NUL segment.
 */
export function parsePorcelain(output: string): Map<string, string> {
  const entries = new Map<string, string>();
  const segments = output.split('\0');
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (!segment || segment.length < 4) continue;
    const code = segment.slice(0, 2);
    const path = segment.slice(3);
    entries.set(path, code);
    if (code.includes('R') || code.includes('C')) index += 1;
  }
  return entries;
}

async function statusEntries(cwd: string, options: GitOptions): Promise<Map<string, string> | null> {
  const run = await git(cwd, ['status', '--porcelain', '-z', '-uall'], options);
  if (!run.ok) return null;
  return parsePorcelain(run.stdout);
}

/** Null when the working directory is not inside a Git work tree. */
export async function captureGitBaseline(
  cwd: string,
  options: GitOptions = {}
): Promise<GitBaseline | null> {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'], options);
  if (!inside.ok || inside.stdout.trim() !== 'true') return null;
  const root = await git(cwd, ['rev-parse', '--show-toplevel'], options);
  const entries = await statusEntries(cwd, options);
  if (!entries) return null;
  return { repoRoot: root.ok ? root.stdout.trim() : cwd, entries };
}

/**
 * Stage and commit the paths this run changed. A failure is reported, never
 * thrown: a verified task must not become a failure because Git refused.
 */
export async function commitRunChanges(
  cwd: string,
  baseline: GitBaseline,
  message: string,
  options: GitOptions = {}
): Promise<CommitResult> {
  const current = await statusEntries(cwd, options);
  if (!current) return { status: 'failed', reason: 'git status failed' };

  // Only paths that were clean when the task started belong to this run. A path
  // that was already dirty is left exactly as the person left it, even if the
  // task also touched it.
  const changed: string[] = [];
  for (const path of current.keys()) {
    if (!baseline.entries.has(path)) changed.push(path);
  }
  if (changed.length === 0) return { status: 'skipped', reason: 'no changes' };

  const add = await git(cwd, ['add', '-A', '--', ...changed], options);
  if (!add.ok) {
    return { status: 'failed', reason: clip(add.stderr || add.stdout || 'git add failed') };
  }
  const commit = await git(cwd, ['commit', '-m', message, '--', ...changed], options);
  if (!commit.ok) {
    return {
      status: 'failed',
      reason: clip(commit.stderr || commit.stdout || 'git commit failed')
    };
  }
  const head = await git(cwd, ['rev-parse', 'HEAD'], options);
  return { status: 'committed', sha: head.ok ? head.stdout.trim() : undefined };
}
