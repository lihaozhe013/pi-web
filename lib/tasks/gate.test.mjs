import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { runVerificationGate } = await jiti.import('./gate.ts');

async function cwdFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pie-task-gate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A command that finishes well after any timeout the test sets below it. */
const SLOW = `node -e "setTimeout(() => {}, 400)"`;

test('a command that exits cleanly passes, without a failure report', async (t) => {
  const cwd = await cwdFixture(t);
  const result = await runVerificationGate(['echo verified'], { cwd, timeoutMs: 5_000 });
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.failedCommand, null);
  // Success carries no output to show on the board.
  assert.equal(result.output, '');
});

test('a failing command reports its exit code and the tail of its output', async (t) => {
  const cwd = await cwdFixture(t);
  const result = await runVerificationGate(
    [`node -e "console.error('boom'); process.exit(1)"`],
    { cwd, timeoutMs: 5_000 }
  );
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /boom/);
});

test('no timeout runs the command to its own end', async (t) => {
  const cwd = await cwdFixture(t);
  const result = await runVerificationGate([SLOW], { cwd, timeoutMs: null });
  assert.equal(result.ok, true);
  assert.equal(result.timedOut, false);
});

test('a timeout still stops a command that overruns it', async (t) => {
  const cwd = await cwdFixture(t);
  const result = await runVerificationGate([SLOW], { cwd, timeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.failedCommand, SLOW);
});

test('the first failure stops the gate, and a later command never runs', async (t) => {
  const cwd = await cwdFixture(t);
  const result = await runVerificationGate(['node -e "process.exit(3)"', 'echo never'], {
    cwd,
    timeoutMs: 5_000
  });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 3);
  assert.doesNotMatch(result.output, /never/);
});
