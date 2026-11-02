import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { startTaskRun } = await jiti.import('./runner.ts');

const fixture = fileURLToPath(new URL('./__fixtures__/rpc-child.mjs', import.meta.url));

async function runFixture(t, scenario, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pie-task-runner-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const activities = [];
  const questions = [];
  const handle = startTaskRun({
    taskId: 1,
    prompt: 'do the task',
    cwd: dir,
    sessionId: 'session-fixture',
    sessionName: 'T1 Fixture',
    projectTrusted: false,
    timeoutMs: 'timeoutMs' in options ? options.timeoutMs : 30_000,
    childCommand: { command: process.execPath, args: [fixture, scenario] },
    onActivity: (activity) => activities.push(activity),
    onQuestion: (question) => questions.push(question)
  });
  return { handle, activities, questions, dir };
}

test('a clean run reports success with the final message as its summary', async (t) => {
  const { handle, activities } = await runFixture(t, 'success');
  const outcome = await handle.result;
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.summary, 'Done: changed one file');
  assert.ok(activities.some((activity) => activity.kind === 'thinking'));
  assert.equal(handle.activity()?.taskId, 1);
});

test('a non-zero exit is a failure, never a success', async (t) => {
  const { handle } = await runFixture(t, 'fail');
  const outcome = await handle.result;
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.exitCode, 3);
  assert.match(outcome.summary, /exited with code 3/);
});

test('the watchdog stops a task that never settles', async (t) => {
  const { handle } = await runFixture(t, 'timeout', { timeoutMs: 200 });
  const outcome = await handle.result;
  assert.equal(outcome.status, 'timeout');
  assert.match(outcome.summary, /did not finish/);
});

test('a run without a watchdog is only ended by an abort', async (t) => {
  // The fixture never settles on its own; with `timeoutMs: null` nothing may
  // stop it, so the abort is the only thing that ends this run.
  const { handle } = await runFixture(t, 'timeout', { timeoutMs: null });
  await new Promise((resolve) => setTimeout(resolve, 150));
  await handle.abort();
  const outcome = await handle.result;
  assert.equal(outcome.status, 'aborted');
});

test('abort ends the run as aborted and leaves the child gone', async (t) => {
  const { handle } = await runFixture(t, 'stubborn');
  await new Promise((resolve) => setTimeout(resolve, 100));
  await handle.abort();
  const outcome = await handle.result;
  assert.equal(outcome.status, 'aborted');
  assert.equal(outcome.summary, 'aborted by user');
  assert.equal(handle.session.hasExited, true);
});

test('a question is recognized, answered by option, and persisted as pending', async (t) => {
  const { handle, questions } = await runFixture(t, 'question');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const asked = questions.find((question) => question !== null);
  assert.ok(asked, 'the question was reported to the board');
  assert.equal(asked.question, 'Which layout?');
  assert.deepEqual(asked.options, ['Sidebar', 'Tabs']);

  await handle.answer({ answer: 'Tabs' });
  const outcome = await handle.result;
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.summary, 'option:Tabs');
  assert.equal(questions.at(-1), null);
});

test('a typed answer takes the two-step sentinel flow', async (t) => {
  const { handle, questions } = await runFixture(t, 'question');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await handle.answer({ answer: 'A third layout' });
  const outcome = await handle.result;
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.summary, 'typed:A third layout');
  assert.equal(questions.at(-1), null);
});

test('a dismissed question is reported as dismissed, not as agreement', async (t) => {
  const { handle } = await runFixture(t, 'question');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await handle.answer({ cancelled: true });
  const outcome = await handle.result;
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.summary, 'dismissed');
});

test('answering without a pending question is refused', async (t) => {
  const { handle } = await runFixture(t, 'success');
  await handle.result;
  await assert.rejects(() => handle.answer({ answer: 'x' }), { code: 'no_pending_question' });
});

test('the prompt carries the unattended rules and the question policy', async () => {
  const { buildTaskPrompt } = await jiti.import('./prompt.ts');
  const withQuestions = buildTaskPrompt({
    task: { id: 7, title: 'Fix it', description: 'Make the gate pass', cwd: '/repo', attempts: 1 },
    verifyCommands: ['bun run lint'],
    allowAskUser: true
  });
  assert.match(withQuestions, /Fix it/);
  assert.match(withQuestions, /\/repo/);
  assert.match(withQuestions, /bun run lint/);
  assert.match(withQuestions, /may use ask_user/);
  assert.match(withQuestions, /what changed, what you verified/);

  const unattended = buildTaskPrompt({
    task: { id: 1, title: 'Write docs', description: null, cwd: '/repo', attempts: 1 },
    verifyCommands: [],
    allowAskUser: false
  });
  assert.match(unattended, /ask_user tool is not available/);
  assert.match(unattended, /No verification commands/);
});
