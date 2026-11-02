import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { TaskStore } = await jiti.import('./store.ts');
const { TaskQueue } = await jiti.import('./queue.ts');
const { TaskTools } = await jiti.import('./agent-tools.ts');

/**
 * A stand-in for the queue loop: the tools only need the surface the board uses,
 * and a real loop would spawn a child process to test a message.
 */
function stubOrchestrator(store, calls) {
  return {
    running: false,
    status() {
      const state = store.getQueueState();
      return {
        state: state.state,
        pausedReason: state.pausedReason,
        activeTaskId: state.activeTaskId,
        running: false,
        activity: null
      };
    },
    start() {
      calls.push(['start']);
      return Promise.resolve();
    },
    async pause(reason, origin) {
      calls.push(['pause', reason, origin]);
      store.setQueueState({ state: 'PAUSED', pausedReason: reason ?? 'paused by user' }, origin);
      return this.status();
    },
    async resume() {
      calls.push(['resume']);
      store.setQueueState({ state: 'RUNNING', pausedReason: null });
      return this.status();
    },
    async abort(origin) {
      calls.push(['abort', origin]);
      store.setQueueState({ state: 'PAUSED', pausedReason: 'aborted by user' }, origin);
      return this.status();
    },
    async answer(taskId, input, origin) {
      calls.push(['answer', taskId, input, origin]);
      if (calls.failAnswer) {
        const error = new Error('The task has no pending question');
        error.code = 'no_pending_question';
        throw error;
      }
      store.resolveQuestion(taskId, { ...input, originSessionId: origin });
    }
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pie-task-tools-'));
  const agentDir = join(root, 'agent');
  const project = join(root, 'project');
  await mkdir(agentDir, { recursive: true });
  await mkdir(project, { recursive: true });
  const store = new TaskStore(join(agentDir, 'pie-tasks.db'));
  // Close before removing: Windows refuses to unlink a database still open.
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const queue = new TaskQueue(store, {
    allowedRoots: () => new Set([project]),
    now: () => new Date()
  });
  const calls = [];
  const orchestrator = stubOrchestrator(store, calls);
  const tools = new TaskTools({
    queue,
    store,
    orchestrator,
    sessionId: 'manager',
    agentDir
  });
  return { root, agentDir, project, store, queue, calls, tools };
}

test('a fresh queue lists nothing and reports the stored state', async (t) => {
  const { tools } = await fixture(t);
  const result = await tools.list();
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.tasks, []);
  assert.deepEqual(result.queue, {
    state: 'IDLE',
    activeTaskId: null,
    pausedReason: null,
    running: false
  });
  assert.deepEqual(result.events, []);
});

test('create validates the title and the working directory', async (t) => {
  const { tools, project, root } = await fixture(t);

  const noTitle = await tools.create({ title: '   ', cwd: project });
  assert.equal(noTitle.ok, false);
  assert.equal(noTitle.code, 'invalid_input');

  const outside = await tools.create({ title: 'Escape', cwd: root });
  assert.equal(outside.ok, false);
  assert.equal(outside.code, 'invalid_input');

  const created = await tools.create({
    title: '  Add the login form  ',
    description: 'Use the existing form styles.',
    cwd: project,
    verifyCommands: ['bun run typecheck']
  });
  assert.equal(created.ok, true);
  assert.equal(created.data.task.title, 'Add the login form');
  assert.equal(created.data.task.status, 'PENDING');
});

test('an event caused elsewhere shows up in the next result and only once', async (t) => {
  const { tools, store, project } = await fixture(t);
  const created = await tools.create({ title: 'One', cwd: project });

  // Another operator claims the task: the claim is this session's news.
  const claimed = store.claimNextPending('token-1', 'task-session');
  assert.ok(claimed);
  const listed = await tools.list();
  assert.deepEqual(
    listed.events.map((event) => event.kind),
    ['claimed']
  );
  assert.deepEqual(listed.events[0], {
    id: listed.events[0].id,
    taskId: claimed.id,
    kind: 'claimed',
    status: 'IN_PROGRESS',
    summary: 'One',
    originSessionId: null,
    createdAt: listed.events[0].createdAt
  });

  // The cursor advanced: the same event is not delivered twice.
  assert.deepEqual((await tools.list()).events, []);
  assert.equal(created.ok, true);
});

test('update is refused while the task runs', async (t) => {
  const { tools, project, store } = await fixture(t);
  const created = await tools.create({ title: 'Locked', cwd: project });
  const id = created.data.task.id;
  store.claimNextPending('token-1', 'task-session');

  const updated = await tools.update({ id, title: 'Renamed' });
  assert.equal(updated.ok, false);
  assert.equal(updated.code, 'task_locked');

  // The refusal still carries the claim that caused it.
  assert.deepEqual(
    updated.events.map((event) => event.kind),
    ['claimed']
  );
});

test('move rewrites the pending order and reports it', async (t) => {
  const { tools, project } = await fixture(t);
  const one = await tools.create({ title: 'One', cwd: project });
  const two = await tools.create({ title: 'Two', cwd: project });
  const three = await tools.create({ title: 'Three', cwd: project });

  const moved = await tools.move({ id: three.data.task.id, position: 1 });
  assert.equal(moved.ok, true);
  assert.deepEqual(moved.data.order, [
    three.data.task.id,
    one.data.task.id,
    two.data.task.id
  ]);
});

test('delete requires an explicit confirmation', async (t) => {
  const { tools, project } = await fixture(t);
  const one = await tools.create({ title: 'One', cwd: project });
  const two = await tools.create({ title: 'Two', cwd: project });

  const refused = await tools.delete({ id: one.data.task.id });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'confirmation_required');

  const deleted = await tools.delete({ ids: [one.data.task.id, two.data.task.id], confirm: true });
  assert.equal(deleted.ok, true);
  assert.deepEqual(deleted.data.deleted, [one.data.task.id, two.data.task.id]);
  assert.deepEqual((await tools.list()).data.tasks, []);
});

test('completed: true removes only finished tasks', async (t) => {
  const { tools, project, store } = await fixture(t);
  const done = await tools.create({ title: 'Done', cwd: project });
  const pending = await tools.create({ title: 'Pending', cwd: project });
  store.markTaskDone(done.data.task.id, 'finished');

  const cleared = await tools.delete({ completed: true, confirm: true });
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.data.deleted, [done.data.task.id]);
  assert.deepEqual(
    (await tools.list()).data.tasks.map((task) => task.id),
    [pending.data.task.id]
  );
});

test('control drives the queue and passes the calling session as the origin', async (t) => {
  const { tools, project, store, calls } = await fixture(t);
  const created = await tools.create({ title: 'One', cwd: project });
  const id = created.data.task.id;

  const started = await tools.control({ action: 'start' });
  assert.equal(started.ok, true);
  assert.deepEqual(calls, [['start']]);

  const paused = await tools.control({ action: 'pause', note: 'review first' });
  assert.equal(paused.ok, true);
  assert.equal(paused.queue.state, 'PAUSED');
  assert.deepEqual(calls[1], ['pause', 'review first', 'manager']);

  const resumed = await tools.control({ action: 'resume' });
  assert.equal(resumed.ok, true);

  const abortedWithoutConfirm = await tools.control({ action: 'abort' });
  assert.equal(abortedWithoutConfirm.code, 'confirmation_required');
  const aborted = await tools.control({ action: 'abort', confirm: true });
  assert.equal(aborted.ok, true);
  assert.deepEqual(calls.at(-1), ['abort', 'manager']);

  store.markTaskDone(id, 'by hand');
  const retried = await tools.control({ action: 'retry', id });
  assert.equal(retried.ok, false);
  assert.equal(retried.code, 'invalid_input');

  const unknown = await tools.control({ action: 'explode' });
  assert.equal(unknown.code, 'invalid_input');
});

test('markDone needs a confirmation and refuses a running task', async (t) => {
  const { tools, project, store } = await fixture(t);
  const created = await tools.create({ title: 'One', cwd: project });
  const id = created.data.task.id;

  const refused = await tools.control({ action: 'markDone', id });
  assert.equal(refused.code, 'confirmation_required');

  store.claimNextPending('token-1', 'task-session');
  const locked = await tools.control({ action: 'markDone', id, confirm: true });
  assert.equal(locked.code, 'task_locked');

  assert.equal(store.getTask(id)?.status, 'IN_PROGRESS');
});

test('answer relays the decision and records who made it', async (t) => {
  const { tools, project, store, calls } = await fixture(t);
  const created = await tools.create({ title: 'Asking', cwd: project });
  const id = created.data.task.id;
  store.claimNextPending('token-1', 'task-session');
  store.setPendingQuestion(id, {
    requestId: 'req-1',
    question: 'Which layout?',
    options: ['Tabs', 'Sidebar'],
    awaitingInput: false,
    askedAt: new Date().toISOString()
  });

  // The refusal still reports the claim and the question the task is waiting on.
  const empty = await tools.answer({ id });
  assert.equal(empty.code, 'invalid_input');
  assert.deepEqual(
    empty.events.map((event) => event.kind),
    ['claimed', 'question']
  );

  const answered = await tools.answer({ id, answer: 'Sidebar' });
  assert.equal(answered.ok, true);
  assert.deepEqual(calls.at(-1), ['answer', id, { answer: 'Sidebar', cancelled: false }, 'manager']);
  assert.equal(store.getTask(id)?.pendingQuestion, null);
  assert.deepEqual(
    answered.events.map((event) => event.kind),
    ['answered']
  );
  assert.equal(answered.events[0].originSessionId, 'manager');

  calls.failAnswer = true;
  const missing = await tools.answer({ id, answer: 'Tabs' });
  assert.equal(missing.code, 'no_pending_question');
});

test('config reads and writes the queue defaults, with an event', async (t) => {
  const { tools, agentDir } = await fixture(t);

  const current = await tools.config();
  assert.equal(current.ok, true);
  assert.deepEqual(current.data.config.verifyCommands, []);

  const updated = await tools.config({ update: { verifyCommands: ['bun run lint'], allowAskUser: true } });
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.data.config.verifyCommands, ['bun run lint']);

  const written = JSON.parse(await readFile(join(agentDir, 'pie-task-orchestrator.json'), 'utf8'));
  assert.deepEqual(written.verifyCommands, ['bun run lint']);

  const events = updated.events.filter((event) => event.kind === 'config');
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, 'queue defaults changed: verification commands, ask_user policy');
  assert.equal(events[0].originSessionId, 'manager');

  const invalid = await tools.config({ update: { verifyTimeoutMs: -1 } });
  assert.equal(invalid.code, 'invalid_input');

  const nothing = await tools.config({ update: { unknownField: true } });
  assert.equal(nothing.code, 'invalid_input');
});

test('the events tool pages forward and honours afterId', async (t) => {
  const { tools, store } = await fixture(t);
  const first = await tools.events({ waitMs: 0 });
  assert.deepEqual(first.data.events, []);

  store.appendEvent({ kind: 'queue', summary: 'IDLE' });
  const second = await tools.events();
  assert.equal(second.data.events.length, 1);
  assert.equal(second.data.events[0].summary, 'IDLE');

  const again = await tools.events();
  assert.deepEqual(again.data.events, []);

  // afterId is an explicit reader position, not the session cursor.
  const replayed = await tools.events({ afterId: 0 });
  assert.equal(replayed.data.events.length, 1);
  assert.equal(replayed.data.cursor, replayed.data.events[0].id);

  const beyond = await tools.events({ afterId: 999 });
  assert.deepEqual(beyond.data.events, []);
});
