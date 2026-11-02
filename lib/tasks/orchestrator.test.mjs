import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { TaskStore } = await jiti.import('./store.ts');
const { TaskQueue } = await jiti.import('./queue.ts');
const { TaskOrchestrator, OrchestratorConflictError } = await jiti.import('./orchestrator.ts');

const fixture = fileURLToPath(new URL('./__fixtures__/rpc-child.mjs', import.meta.url));

async function fixtureFor(t, scenario, config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pie-task-orchestrator-'));
  const agentDir = join(root, 'agent');
  const project = join(root, 'project');
  await mkdir(agentDir, { recursive: true });
  await mkdir(project, { recursive: true });
  if (Object.keys(config).length > 0) {
    await writeFile(join(agentDir, 'pie-task-orchestrator.json'), JSON.stringify(config));
  }
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
  const notifications = [];
  const orchestrator = new TaskOrchestrator({
    store,
    queue,
    agentDir,
    lockPath: join(agentDir, 'pie-tasks.lock'),
    notifier: (notification) => notifications.push(notification),
    childCommand: { command: process.execPath, args: [fixture, scenario] },
    askUserExtensionPath: null
  });
  return { root, agentDir, project, store, queue, orchestrator, notifications };
}

test('an empty queue reads as complete and idles', async (t) => {
  const { orchestrator, notifications, queue } = await fixtureFor(t, 'success');
  await orchestrator.start();
  assert.equal(queue.getQueueState().state, 'IDLE');
  assert.equal(orchestrator.running, false);
  assert.deepEqual(
    notifications.map((notification) => notification.kind),
    ['complete']
  );
});

test('claim, run, and continue with the next pending task', async (t) => {
  const { orchestrator, queue, project, notifications } = await fixtureFor(t, 'success');
  await queue.createTask({ title: 'First', cwd: project });
  await queue.createTask({ title: 'Second', cwd: project });

  await orchestrator.start();

  const tasks = queue.listTasks();
  assert.deepEqual(
    tasks.map((task) => task.status),
    ['DONE', 'DONE']
  );
  assert.ok(tasks.every((task) => task.sessionId && task.sessionId.length === 36));
  // Every attempt had its own session.
  assert.notEqual(tasks[0].sessionId, tasks[1].sessionId);
  assert.equal(queue.getQueueState().state, 'IDLE');
  assert.deepEqual(
    notifications.map((notification) => notification.kind),
    ['done', 'done', 'complete']
  );
  assert.equal(queue.listRuns().length, 2);
});

test('a failed verification blocks the task and pauses the queue', async (t) => {
  const { orchestrator, queue, project, notifications } = await fixtureFor(t, 'success', {
    verifyCommands: ['exit 1']
  });
  const task = await queue.createTask({ title: 'Fails the gate', cwd: project });
  await orchestrator.start();

  const settled = queue.getTask(task.id);
  assert.equal(settled.status, 'BLOCKED');
  assert.equal(settled.verifyOutput !== null, true);
  assert.equal(queue.getQueueState().state, 'PAUSED');
  assert.equal(queue.getQueueState().pausedReason?.startsWith('Verification failed'), true);
  assert.equal(orchestrator.running, false);
  assert.equal(notifications.at(-1).kind, 'blocked');
  assert.equal(queue.listRunsForTask(task.id)[0].verifyExit, 1);
});

test('a failed verification carries its own output into the reason and the summary', async (t) => {
  const command = `node -e "console.error('gate says no'); process.exit(2)"`;
  const { orchestrator, queue, project, store, notifications } = await fixtureFor(t, 'success', {
    verifyCommands: [command]
  });
  const task = await queue.createTask({ title: 'Fails with output', cwd: project });
  await orchestrator.start();

  const settled = queue.getTask(task.id);
  assert.equal(settled.status, 'BLOCKED');
  assert.match(settled.resultSummary, /gate says no/);

  // The queue state is one line, so it carries the first line of the output.
  const pausedReason = queue.getQueueState().pausedReason;
  assert.match(pausedReason, /^Verification failed \(exit 2\): .* — gate says no$/);
  assert.equal(notifications.at(-1).reason, pausedReason);

  // The digest and the tool result read the same event summary.
  const event = store.listEventsSince(0).find((entry) => entry.kind === 'settled');
  assert.match(event.summary, /gate says no/);
  assert.match(event.summary, /Output:/);
});

test('a crash fails the task and pauses the loop', async (t) => {
  const { orchestrator, queue, project } = await fixtureFor(t, 'crash');
  const task = await queue.createTask({ title: 'Crashes', cwd: project });
  await orchestrator.start();
  assert.equal(queue.getTask(task.id).status, 'FAILED');
  assert.equal(queue.getQueueState().state, 'PAUSED');
});

test('a restart blocks what the old process left running', async (t) => {
  const { orchestrator, queue, project, store } = await fixtureFor(t, 'success');
  // Simulate a server that died mid-run: the row still says IN_PROGRESS.
  await queue.createTask({ title: 'Interrupted', cwd: project });
  store.claimNextPending('old-token', 'old-session');
  assert.equal(queue.listTasks()[0].status, 'IN_PROGRESS');

  await orchestrator.start();
  const task = queue.getTask(queue.listTasks()[0].id);
  assert.equal(task.status, 'BLOCKED');
  assert.equal(task.resultSummary, 'orchestrator restarted during the run');
  assert.equal(queue.getQueueState().state, 'PAUSED');
});

test('a question travels through the queue and its answer resumes the run', async (t) => {
  const { orchestrator, queue, project } = await fixtureFor(t, 'question', { allowAskUser: true });
  const task = await queue.createTask({ title: 'Asks', cwd: project });
  const loop = orchestrator.start();

  let pending = null;
  for (let attempt = 0; attempt < 100 && !pending; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    pending = queue.getTask(task.id).pendingQuestion;
  }
  assert.ok(pending, 'the question was stored on the task');
  assert.equal(pending.question, 'Which layout?');
  assert.deepEqual(pending.options, ['Sidebar', 'Tabs']);

  await orchestrator.answer(task.id, { answer: 'Sidebar' });
  await loop;

  assert.equal(queue.getTask(task.id).status, 'DONE');
  assert.equal(queue.getTask(task.id).pendingQuestion, null);
  assert.match(queue.getTask(task.id).resultSummary, /option:Sidebar/);
});

test('abort settles the run as blocked and pauses the queue', async (t) => {
  const { orchestrator, queue, project } = await fixtureFor(t, 'stubborn');
  const task = await queue.createTask({ title: 'Stubborn', cwd: project });
  const loop = orchestrator.start();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (queue.getTask(task.id).status === 'IN_PROGRESS') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await orchestrator.abort();
  await loop;
  const settled = queue.getTask(task.id);
  assert.equal(settled.status, 'BLOCKED');
  assert.equal(settled.resultSummary, 'aborted by user');
  assert.equal(queue.getQueueState().state, 'PAUSED');
});

test('a second start is refused while the loop owns the queue', async (t) => {
  const { orchestrator, queue, project } = await fixtureFor(t, 'stubborn');
  const task = await queue.createTask({ title: 'Runs', cwd: project });
  const loop = orchestrator.start();
  await assert.rejects(() => orchestrator.start(), OrchestratorConflictError);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (queue.getTask(task.id).status === 'IN_PROGRESS') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await orchestrator.abort();
  await loop;
});

test('pause takes effect between tasks, never mid-run', async (t) => {
  const { orchestrator, queue, project } = await fixtureFor(t, 'success');
  const first = await queue.createTask({ title: 'First', cwd: project });
  const second = await queue.createTask({ title: 'Second', cwd: project });
  const loop = orchestrator.start();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (queue.getTask(first.id).status === 'IN_PROGRESS') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await orchestrator.pause();
  await loop;
  const tasks = queue.listTasks();
  assert.equal(tasks[0].status, 'DONE');
  assert.equal(queue.getTask(second.id).status, 'PENDING');
  assert.equal(queue.getQueueState().state, 'PAUSED');
});
