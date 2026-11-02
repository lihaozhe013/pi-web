import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { TaskStore } = await jiti.import('./store.ts');
const { appendToTail: appendTail, TASK_TAIL_LIMIT } = await jiti.import('./rpc-session.ts');
async function tempDatabase(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pie-task-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'pie-tasks.db');
}

function insertPending(store, title, cwd = '/tmp') {
  return store.insertTask({
    title,
    description: null,
    cwd,
    rank: store.nextRank(),
    allowAskUser: null,
    verifyCommands: null,
    autoCommit: null,
    now: new Date().toISOString()
  });
}

test('creates the schema with WAL, queue state, and an idempotent migration', async (t) => {
  const path = await tempDatabase(t);
  const store = new TaskStore(path);
  t.after(() => store.close());

  assert.equal(store.journalMode, 'wal');
  assert.deepEqual(store.listTasks(), []);
  const state = store.getQueueState();
  assert.equal(state.state, 'IDLE');
  assert.equal(state.activeTaskId, null);

  const task = insertPending(store, 'First');
  assert.equal(task.status, 'PENDING');
  assert.equal(task.rank, 10);

  // Reopening must not re-run the migration or lose rows.
  store.close();
  const reopened = new TaskStore(path);
  t.after(() => reopened.close());
  assert.equal(reopened.getTask(task.id)?.title, 'First');
  assert.equal(reopened.listTasks().length, 1);
});

test('appends ranks at the end and rewrites the pending segment as tens', async (t) => {
  const store = new TaskStore(await tempDatabase(t));
  t.after(() => store.close());
  const first = insertPending(store, 'One');
  const second = insertPending(store, 'Two');
  const third = insertPending(store, 'Three');
  assert.deepEqual(
    [first.rank, second.rank, third.rank],
    [10, 20, 30]
  );

  store.rewritePendingRanks([third.id, first.id, second.id]);
  assert.deepEqual(
    store.pendingTasks().map((task) => [task.id, task.rank]),
    [
      [third.id, 10],
      [first.id, 20],
      [second.id, 30]
    ]
  );
});

test('a claim asserts that no other row is running', async (t) => {
  const path = await tempDatabase(t);
  const store = new TaskStore(path);
  t.after(() => store.close());
  insertPending(store, 'One');
  insertPending(store, 'Two');

  const first = store.claimNextPending('token-1', 'session-1');
  assert.equal(first?.status, 'IN_PROGRESS');
  assert.equal(first?.attempts, 1);
  assert.equal(first?.claimedToken, 'token-1');
  assert.throws(
    () => store.claimNextPending('token-2', 'session-2'),
    /already in progress/
  );
});

test('settling writes the run record and the queue state in one transaction', async (t) => {
  const store = new TaskStore(await tempDatabase(t));
  t.after(() => store.close());
  const task = insertPending(store, 'One');
  const claimed = store.claimNextPending('token-1', 'session-1');

  const settled = store.settleTask(claimed.id, 'token-1', {
    status: 'DONE',
    resultSummary: 'all good',
    exitCode: 0,
    sessionId: 'session-1',
    verifyOutput: null,
    verifyExit: 0,
    commitSha: null,
    outputTail: 'tail',
    queueState: { state: 'RUNNING', pausedReason: null, activeTaskId: null }
  });
  assert.equal(settled?.status, 'DONE');
  assert.equal(settled?.resultSummary, 'all good');
  assert.equal(store.getQueueState().state, 'RUNNING');

  const runs = store.listRunsForTask(task.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].attempt, 1);
  assert.equal(runs[0].status, 'DONE');
  assert.equal(runs[0].exitCode, 0);

  // A late writer with the old token cannot settle the same attempt again.
  assert.equal(
    store.settleTask(claimed.id, 'token-1', {
      status: 'FAILED',
      resultSummary: 'late',
      exitCode: 1,
      sessionId: 'session-1'
    }),
    null
  );
});

test('an interrupted run recovers as BLOCKED and pauses the queue', async (t) => {
  const store = new TaskStore(await tempDatabase(t));
  t.after(() => store.close());
  insertPending(store, 'One');
  store.claimNextPending('token-1', 'session-1');

  const recovered = store.recoverInterrupted('orchestrator restarted during the run');
  assert.equal(recovered.length, 1);
  assert.equal(store.listTasks()[0].status, 'BLOCKED');
  assert.equal(store.getQueueState().state, 'PAUSED');
  assert.equal(store.listTasks()[0].attempts, 1);
  // Recovery creates no run record: that attempt never settled.
  assert.equal(store.listRuns().length, 0);
});

test('the output tail is bounded and keeps the newest text', () => {
  const tail = appendTail('', 'abcd', 4);
  assert.equal(tail, 'abcd');
  assert.equal(appendTail(tail, 'ef', 4), 'cdef');
  assert.equal(TASK_TAIL_LIMIT, 64 * 1024);
});
