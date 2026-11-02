import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { TaskStore } = await jiti.import('./store.ts');
const { TaskQueue, TaskLockedError, TaskMoveError, TaskInputError } =
  await jiti.import('./queue.ts');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pie-task-queue-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  await mkdir(project, { recursive: true });
  const store = new TaskStore(join(root, 'pie-tasks.db'));
  t.after(() => store.close());
  const queue = new TaskQueue(store, { allowedRoots: () => new Set([project]) });
  return { root, project, store, queue };
}

test('createTask validates the title and the working directory', async (t) => {
  const { queue, project, root } = await fixture(t);

  await assert.rejects(() => queue.createTask({ title: '  ', cwd: project }), TaskInputError);
  await assert.rejects(() => queue.createTask({ title: 'x', cwd: join(root, 'missing') }), {
    code: 'invalid_input'
  });
  await assert.rejects(() => queue.createTask({ title: 'x', cwd: root }), {
    code: 'invalid_input'
  });

  const task = await queue.createTask({ title: '  Fix the gate  ', cwd: project });
  assert.equal(task.title, 'Fix the gate');
  assert.equal(task.status, 'PENDING');
  assert.equal(task.allowAskUser, null);
  assert.equal(task.verifyCommands, null);
});

test('new tasks append at the end and move rewrites only the pending segment', async (t) => {
  const { queue, project } = await fixture(t);
  const one = await queue.createTask({ title: 'One', cwd: project });
  const two = await queue.createTask({ title: 'Two', cwd: project });
  const three = await queue.createTask({ title: 'Three', cwd: project });

  queue.moveTask(three.id, { direction: 'up' });
  assert.deepEqual(
    queue.listTasks().map((task) => task.title),
    ['One', 'Three', 'Two']
  );
  queue.moveTask(three.id, { position: 3 });
  assert.deepEqual(
    queue.listTasks().map((task) => task.title),
    ['One', 'Two', 'Three']
  );
  assert.equal(queue.getTask(one.id).rank, 10);

  const claimed = queue.claimNext('session-1');
  assert.equal(claimed?.id, one.id);
  // A running task refuses a move; the guard is in the controller.
  assert.throws(() => queue.moveTask(one.id, { direction: 'down' }), TaskMoveError);
  assert.equal(queue.getTask(two.id).status, 'PENDING');
});

test('a running task cannot be edited or deleted', async (t) => {
  const { queue, project } = await fixture(t);
  const task = await queue.createTask({ title: 'One', cwd: project });
  const claimed = queue.claimNext('session-1');
  assert.equal(claimed?.id, task.id);

  await assert.rejects(() => queue.updateTask(task.id, { title: 'Changed' }), TaskLockedError);
  assert.throws(() => queue.deleteTask(task.id), TaskLockedError);
  assert.equal(queue.getTask(task.id).title, 'One');
});

test('claimNext takes the lowest rank only once and records the attempt', async (t) => {
  const { queue, project, store } = await fixture(t);
  const one = await queue.createTask({ title: 'One', cwd: project });
  const two = await queue.createTask({ title: 'Two', cwd: project });

  const claimed = queue.claimNext('session-1');
  assert.equal(claimed?.id, one.id);
  assert.equal(claimed?.attempts, 1);
  assert.equal(claimed?.sessionId, 'session-1');
  assert.equal(claimed?.claimedToken?.length, 36);
  assert.equal(store.inProgressTask()?.id, one.id);

  // A second claim refuses to run two agents; the invariant is in the claim.
  assert.throws(() => queue.claimNext('session-2'), /already in progress/);
  assert.equal(queue.getTask(two.id).status, 'PENDING');
});

test('settle is conditioned on the caller still owning the claim', async (t) => {
  const { queue, project } = await fixture(t);
  const task = await queue.createTask({ title: 'One', cwd: project });
  const claimed = queue.claimNext('session-1');

  const done = queue.settle(claimed.id, claimed.claimedToken, {
    status: 'DONE',
    resultSummary: 'ok',
    exitCode: 0,
    sessionId: 'session-1'
  });
  assert.equal(done.status, 'DONE');
  assert.equal(done.finishedAt === null, false);

  assert.throws(
    () =>
      queue.settle(claimed.id, 'stale-token', {
        status: 'FAILED',
        resultSummary: 'late',
        exitCode: 1,
        sessionId: 'session-1'
      }),
    TaskLockedError
  );
  assert.equal(queue.listRunsForTask(task.id).length, 1);
});

test('retry returns blocked and failed tasks to the queue; markDone is human only', async (t) => {
  const { queue, project } = await fixture(t);
  const task = await queue.createTask({ title: 'One', cwd: project });
  const claimed = queue.claimNext('session-1');
  queue.settle(claimed.id, claimed.claimedToken, {
    status: 'BLOCKED',
    resultSummary: 'gate failed',
    exitCode: 0,
    sessionId: 'session-1'
  });

  const retried = queue.retryTask(task.id);
  assert.equal(retried.status, 'PENDING');
  assert.equal(retried.attempts, 1);
  assert.throws(() => queue.retryTask(task.id), TaskInputError);

  const done = queue.markDone(task.id, 'finished by hand');
  assert.equal(done.status, 'DONE');
  assert.equal(done.resultSummary, 'finished by hand');
});

test('recovery blocks a row the previous process left running', async (t) => {
  const { queue, project } = await fixture(t);
  await queue.createTask({ title: 'One', cwd: project });
  const claimed = queue.claimNext('session-1');
  assert.equal(claimed?.status, 'IN_PROGRESS');

  const recovered = queue.recoverInterrupted();
  assert.equal(recovered.length, 1);
  const task = queue.listTasks()[0];
  assert.equal(task.status, 'BLOCKED');
  assert.equal(task.resultSummary, 'orchestrator restarted during the run');
  assert.equal(queue.getQueueState().state, 'PAUSED');
});
