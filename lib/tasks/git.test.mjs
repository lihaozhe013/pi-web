import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { captureGitBaseline, commitRunChanges, parsePorcelain } = await jiti.import('./git.ts');

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function repoFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pie-task-git-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'pie@example.test');
  git(dir, 'config', 'user.name', 'Pie Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(dir, 'tracked.txt'), 'one\n');
  git(dir, 'add', 'tracked.txt');
  git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

test('a directory outside a work tree has no baseline', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pie-task-not-git-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(await captureGitBaseline(dir), null);
});

test('no changes after the run means a skip, not an empty commit', async (t) => {
  const dir = await repoFixture(t);
  const baseline = await captureGitBaseline(dir);
  const result = await commitRunChanges(dir, baseline, 'chore(task): #1 nothing');
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no changes/);
});

test('only this run changes are committed; pre-existing dirt is left alone', async (t) => {
  const dir = await repoFixture(t);
  // Dirt that was already there when the task started.
  await writeFile(join(dir, 'tracked.txt'), 'dirty before the task\n');
  await writeFile(join(dir, 'preexisting.txt'), 'untracked before\n');
  const baseline = await captureGitBaseline(dir);
  assert.ok(baseline);

  // The run's own work.
  await writeFile(join(dir, 'created.txt'), 'created by the task\n');
  await writeFile(join(dir, 'tracked.txt'), 'changed by the task\n');

  const result = await commitRunChanges(dir, baseline, 'chore(task): #1 created a file');
  assert.equal(result.status, 'committed');
  assert.ok(result.sha);

  const committed = git(dir, 'show', '--name-only', '--pretty=format:', 'HEAD')
    .split('\n')
    .filter(Boolean)
    .sort();
  // The path that was already dirty belongs to the person, not to this run.
  assert.deepEqual(committed, ['created.txt']);

  const status = git(dir, 'status', '--porcelain');
  assert.match(status, /\?\? preexisting\.txt/);
  assert.match(status, / M tracked\.txt/);
  assert.equal(git(dir, 'log', '--oneline', '-1').includes('created a file'), true);
});

test('a commit failure is reported, not thrown', async (t) => {
  const dir = await repoFixture(t);
  const baseline = await captureGitBaseline(dir);
  await writeFile(join(dir, 'next.txt'), 'x\n');
  git(dir, 'config', 'user.email', '');
  git(dir, 'config', 'user.name', '');
  const result = await commitRunChanges(dir, baseline, 'chore(task): #2 will fail', {
    env: { ...process.env, GIT_AUTHOR_NAME: '', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: '', GIT_COMMITTER_EMAIL: '' }
  });
  // Either the commit succeeded (ambient identity) or it failed with a reason;
  // a thrown error would fail this test.
  assert.ok(result.status === 'committed' || result.status === 'failed');
  if (result.status === 'failed') assert.ok(result.reason);
});

test('porcelain parsing keeps renames readable', () => {
  const entries = parsePorcelain('R  new.txt\0old.txt\0 M changed.txt\0?? added.txt\0');
  assert.equal(entries.get('new.txt'), 'R ');
  assert.equal(entries.get('changed.txt'), ' M');
  assert.equal(entries.get('added.txt'), '??');
});

test('the committed file content is the run version', async (t) => {
  const dir = await repoFixture(t);
  const baseline = await captureGitBaseline(dir);
  await writeFile(join(dir, 'tracked.txt'), 'two\n');
  await commitRunChanges(dir, baseline, 'chore(task): #3 update');
  const content = await readFile(join(dir, 'tracked.txt'), 'utf8');
  assert.equal(git(dir, 'show', 'HEAD:tracked.txt', '--').trim(), content.trim());
});
