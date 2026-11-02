import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
import { DatabaseSync } from 'node:sqlite';

const jiti = createJiti(import.meta.url);
const { TaskStore, TASK_EVENT_SUMMARY_MAX_LENGTH } = await jiti.import('./store.ts');
const { appendToTail: appendTail, TASK_TAIL_LIMIT } = await jiti.import('./rpc-session.ts');

/**
 * One temporary database per test. The store is closed *before* the directory is
 * removed; on Windows an open WAL handle makes the unlink fail.
 */
async function tempDatabase(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pie-task-store-'));
  const path = join(dir, 'pie-tasks.db');
  const stores = [];
  const open = (target = path) => {
    const store = new TaskStore(target);
    stores.push(store);
    return store;
  };
  t.after(async () => {
    for (const store of stores) store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, path, open };
}

function insertPending(store, title, cwd = '/tmp') {
  return store.insertTask({
    title,
    description: null,
    cwd,
    rank: store.nextRank(),
    allowAskUser: null,
    verifyCommands: null,
    now: new Date().toISOString()
  });
}

test('creates the schema with WAL, queue state, and an idempotent migration', async (t) => {
  const { open } = await tempDatabase(t);
  const store = open();

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
  const reopened = open();
  assert.equal(reopened.getTask(task.id)?.title, 'First');
  assert.equal(reopened.listTasks().length, 1);
});

test('a version 1 database drops the commit columns and keeps its rows', async (t) => {
  const { path, open } = await tempDatabase(t);
  const store = open();
  const task = insertPending(store, 'Keep me');
  store.close();

  // Recreate the shape a database written before commit support was removed has.
  const raw = new DatabaseSync(path);
  raw.exec(`
    ALTER TABLE tasks ADD COLUMN auto_commit INTEGER;
    ALTER TABLE tasks ADD COLUMN commit_sha TEXT;
    ALTER TABLE task_runs ADD COLUMN commit_sha TEXT;
    PRAGMA user_version = 1;
  `);
  raw.close();

  const reopened = open();
  assert.equal(reopened.getTask(task.id)?.title, 'Keep me');

  const rawAgain = new DatabaseSync(path);
  const columns = ['tasks', 'task_runs'].flatMap((table) =>
    rawAgain
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => column.name)
  );
  rawAgain.close();
  assert.equal(columns.includes('auto_commit'), false);
  assert.equal(columns.includes('commit_sha'), false);
});

test('a version 2 database gains the event tables and keeps its tasks', async (t) => {
  const { path, open } = await tempDatabase(t);
  const store = open();
  const task = insertPending(store, 'Older than events');
  store.close();

  const raw = new DatabaseSync(path);
  raw.exec(`
    DROP TABLE task_events;
    DROP TABLE task_event_cursors;
    DROP TABLE task_manager_watch;
    PRAGMA user_version = 2;
  `);
  raw.close();

  const reopened = open();
  assert.equal(reopened.getTask(task.id)?.title, 'Older than events');
  assert.deepEqual(reopened.listEventsSince(0), []);
  assert.equal(reopened.getEventCursor('never-seen'), 0);
  assert.equal(reopened.getWatch(), null);
});

test('appends ranks at the end and rewrites the pending segment as tens', async (t) => {
  const { open } = await tempDatabase(t);
  const store = open();
  const first = insertPending(store, 'One');
  const second = insertPending(store, 'Two');
  const third = insertPending(store, 'Three');
  assert.deepEqual([first.rank, second.rank, third.rank], [10, 20, 30]);

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
  const { open } = await tempDatabase(t);
  const store = open();
  insertPending(store, 'One');
  insertPending(store, 'Two');

  const first = store.claimNextPending('token-1', 'session-1');
  assert.equal(first?.status, 'IN_PROGRESS');
  assert.equal(first?.attempts, 1);
  assert.equal(first?.claimedToken, 'token-1');
  assert.throws(() => store.claimNextPending('token-2', 'session-2'), /already in progress/);
});

test('settling writes the run record and the queue state in one transaction', async (t) => {
  const { open } = await tempDatabase(t);
  const store = open();
  const task = insertPending(store, 'One');
  const claimed = store.claimNextPending('token-1', 'session-1');

  const settled = store.settleTask(claimed.id, 'token-1', {
    status: 'DONE',
    resultSummary: 'all good',
    exitCode: 0,
    sessionId: 'session-1',
    verifyOutput: null,
    verifyExit: 0,
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
  const { open } = await tempDatabase(t);
  const store = open();
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

test('claim, settle, and queue transitions append ordered events', async (t) => {
  const { open } = await tempDatabase(t);
  const store = open();
  const task = insertPending(store, 'First task');
  assert.deepEqual(store.listEventsSince(0), []);

  const claimed = store.claimNextPending('token-1', 'session-1');
  store.settleTask(claimed.id, 'token-1', {
    status: 'BLOCKED',
    resultSummary: 'verification failed',
    exitCode: 0,
    sessionId: 'session-1',
    queueState: { state: 'PAUSED', pausedReason: 'verification failed', activeTaskId: null }
  });

  const events = store.listEventsSince(0);
  assert.deepEqual(
    events.map((event) => [event.kind, event.taskId, event.status]),
    [
      ['claimed', task.id, 'IN_PROGRESS'],
      ['settled', task.id, 'BLOCKED'],
      ['queue', null, null]
    ]
  );
  assert.equal(events[0].summary, 'First task');
  assert.equal(events[1].summary, 'verification failed');
  assert.equal(events[2].summary, 'PAUSED: verification failed');
  assert.deepEqual(
    events.map((event) => event.id),
    [...events.map((event) => event.id)].sort((a, b) => a - b)
  );
});

test('a question and its answer are events, and the answer carries the origin', async (t) => {
  const { open } = await tempDatabase(t);
  const store = open();
  const task = insertPending(store, 'Asking');
  store.claimNextPending('token-1', 'session-1');

  store.setPendingQuestion(task.id, {
    requestId: 'req-1',
    question: 'Which layout?',
    options: ['Tabs', 'Sidebar'],
    awaitingInput: false,
    askedAt: new Date().toISOString()
  });
  store.resolveQuestion(task.id, { answer: 'Sidebar', originSessionId: 'manager-session' });

  const events = store.listEventsSince(0).filter((event) => event.kind !== 'claimed');
  assert.deepEqual(
    events.map((event) => [event.kind, event.summary, event.originSessionId]),
    [
      ['question', 'Which layout?', null],
      ['answered', 'Sidebar', 'manager-session']
    ]
  );
  assert.equal(store.getTask(task.id)?.pendingQuestion, null);

  store.resolveQuestion(task.id, { cancelled: true });
  assert.equal(store.listEventsSince(0).at(-1)?.summary, 'question dismissed');
});

test('an event never survives without the row it describes', async (t) => {
  const { open } = await tempDatabase(t);
  const store = open();
  insertPending(store, 'Doomed');

  assert.throws(() =>
    store.transaction(() => {
      store.claimNextPending('token-1', 'session-1');
      throw new Error('rollback');
    })
  );

  assert.equal(store.listTasks()[0].status, 'PENDING');
  assert.deepEqual(store.listEventsSince(0), []);
});

test('a session cursor returns each event once and never moves backwards', async (t) => {
  const { open } = await tempDatabase(t);
  const store = open();
  insertPending(store, 'One');
  insertPending(store, 'Two');

  const first = store.readSessionEvents('manager');
  assert.deepEqual(first.events, []);
  assert.equal(first.cursor, 0);

  store.claimNextPending('token-1', 'session-1');
  const second = store.readSessionEvents('manager');
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].kind, 'claimed');
  assert.equal(store.getEventCursor('manager'), second.events[0].id);

  assert.deepEqual(store.readSessionEvents('manager').events, []);

  store.setEventCursor('manager', 0);
  assert.equal(store.getEventCursor('manager'), second.events[0].id);

  store.setQueueState({ state: 'PAUSED', pausedReason: 'by hand' }, 'manager');
  const third = store.readSessionEvents('manager');
  assert.deepEqual(
    third.events.map((event) => event.kind),
    ['queue']
  );
  assert.equal(third.events[0].originSessionId, 'manager');

  // Another session has its own cursor and sees the same history.
  assert.equal(store.readSessionEvents('other').events.length, 2);
});

test('a queue event is only written when the state or the reason changes', async (t) => {
  const { open } = await tempDatabase(t);
  const store = open();
  insertPending(store, 'One');

  store.setQueueState({ state: 'RUNNING', activeTaskId: 1 });
  assert.equal(store.listEventsSince(0).length, 1);
  // The active task is already announced by `claimed`, so it is not an event.
  store.setQueueState({ state: 'RUNNING', activeTaskId: null });
  assert.equal(store.listEventsSince(0).length, 1);

  store.setQueueState({ state: 'PAUSED', pausedReason: 'manual' });
  store.setQueueState({ state: 'PAUSED', pausedReason: 'manual' });
  const events = store.listEventsSince(0);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => event.summary),
    ['RUNNING', 'PAUSED: manual']
  );
});

test('event summaries are bounded', async (t) => {
  const { open } = await tempDatabase(t);
  const store = open();
  const long = 'x'.repeat(TASK_EVENT_SUMMARY_MAX_LENGTH + 50);
  const event = store.appendEvent({ kind: 'queue', summary: long });
  assert.equal(event.summary?.length, TASK_EVENT_SUMMARY_MAX_LENGTH);
});

test('the watch row is single, counts wakes, and clears', async (t) => {
  const { open } = await tempDatabase(t);
  const store = open();
  assert.equal(store.getWatch(), null);

  const started = store.setWatch('manager', '2024-01-01T00:00:00.000Z');
  assert.deepEqual(started, { sessionId: 'manager', startedAt: '2024-01-01T00:00:00.000Z', wakes: 0 });

  const bumped = store.bumpWatchWakes();
  assert.equal(bumped?.wakes, 1);
  assert.equal(store.bumpWatchWakes()?.wakes, 2);

  // Starting again replaces the row, so there is never a second watcher.
  store.setWatch('successor');
  assert.deepEqual(store.getWatch(), {
    sessionId: 'successor',
    startedAt: store.getWatch()?.startedAt,
    wakes: 0
  });
  assert.equal(store.getWatch()?.wakes, 0);

  store.clearWatch('manager');
  assert.equal(store.getWatch()?.sessionId, 'successor');
  store.clearWatch();
  assert.equal(store.getWatch(), null);
});

test('deleting a task removes its events and keeps queue-level ones', async (t) => {
  const { open } = await tempDatabase(t);
  const store = open();
  const task = insertPending(store, 'Removable');
  store.claimNextPending('token-1', 'session-1');
  store.settleTask(task.id, 'token-1', {
    status: 'DONE',
    resultSummary: 'ok',
    exitCode: 0,
    sessionId: 'session-1'
  });
  store.appendEvent({ kind: 'config', summary: 'queue defaults changed: model' });

  assert.equal(store.listEventsSince(0).length, 3);
  assert.equal(store.deleteTask(task.id), true);
  const remaining = store.listEventsSince(0);
  assert.deepEqual(
    remaining.map((event) => event.kind),
    ['config']
  );
});
