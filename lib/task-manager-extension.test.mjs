import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createTaskManagerExtension, TASK_EVENT_CUSTOM_TYPE } = await jiti.import(
  '@/lib/task-manager-extension.ts'
);
const { TASK_MANAGER_TOOL_NAMES, formatTaskToolResult, formatTaskEventDigest } =
  await jiti.import('@/lib/tasks/agent-tools.ts');
const { resetTaskStore } = await jiti.import('@/lib/tasks/store.ts');
const { resetTaskOrchestrator, getTaskOrchestrator } = await jiti.import(
  '@/lib/tasks/orchestrator.ts'
);
const { allowFileRoot } = await jiti.import('@/lib/allowed-roots.ts');
const { hasActiveSessionLivenessProvider } = await jiti.import('@/lib/session-liveness.ts');

/**
 * One isolated agent directory per test: the tools resolve the queue from the
 * environment, so each test also gets its own database and watch row.
 */
async function harness(t, options = {}) {
  const agentDir = await mkdtemp(join(tmpdir(), 'pie-task-manager-ext-'));
  const project = join(agentDir, 'project');
  await mkdir(project, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  allowFileRoot(project);
  resetTaskOrchestrator();
  resetTaskStore();

  const tools = new Map();
  const messages = [];
  const handlers = new Map();
  const pi = {
    registerTool: (tool) => tools.set(tool.name, tool),
    on: (event, handler) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    appendEntry: () => {},
    setSessionName: () => {},
    sendMessage: (message, sendOptions) => messages.push({ message, options: sendOptions })
  };
  const extension = createTaskManagerExtension(options);
  extension.factory(pi);

  const context = (sessionId = 'manager-session') => ({
    cwd: project,
    hasUI: false,
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => join(agentDir, 'sessions', `${sessionId}.jsonl`),
      getCwd: () => project
    }
  });

  const store = () => getTaskOrchestrator().queue.store;
  const call = (name, params, sessionId = 'manager-session') =>
    tools.get(name).execute('call', params, undefined, undefined, context(sessionId));

  t.after(async () => {
    const shutdown = handlers.get('session_shutdown');
    if (shutdown) shutdown({ type: 'session_shutdown' }, context());
    resetTaskOrchestrator();
    resetTaskStore();
    await rm(agentDir, { recursive: true, force: true });
  });

  return { agentDir, project, tools, messages, handlers, context, store, call };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return predicate();
}

test('every queue tool is registered as a sequential direct tool', async (t) => {
  const { tools, call } = await harness(t);
  assert.deepEqual([...tools.keys()].sort(), [...TASK_MANAGER_TOOL_NAMES].sort());
  for (const [name, tool] of tools) {
    assert.equal(tool.executionMode, 'sequential', `${name} must not run beside another tool`);
    assert.ok(tool.description.length > 20, `${name} needs a description`);
    assert.ok(tool.promptGuidelines?.length, `${name} needs guidelines`);
  }
  const status = await call('task_watch', { action: 'status' });
  assert.equal(status.details.ok, true);
  assert.equal(status.details.data.watching, false);
});

test('a tool call answers with the queue and the data', async (t) => {
  const { call, project } = await harness(t);
  const created = await call('task_create', { title: 'Add the login form', cwd: project });
  const createdText = created.content[0].text;
  assert.match(createdText, /^ok/m);
  assert.match(createdText, /queue IDLE/);
  assert.equal(created.details.data.task.title, 'Add the login form');

  const listed = await call('task_list', {});
  assert.match(listed.content[0].text, /Add the login form/);
  assert.equal(listed.details.data.tasks.length, 1);
  // The create call already consumed its own event.
  assert.deepEqual(listed.details.events, []);
});

test('a refusal is a result, not an exception', async (t) => {
  const { call } = await harness(t);
  const result = await call('task_delete', { id: 999 });
  assert.equal(result.details.ok, false);
  assert.equal(result.details.code, 'confirmation_required');
  assert.match(result.content[0].text, /^refused \(confirmation_required\)/);
});

test('the formatter leads with the outcome and lists the news', () => {
  const text = formatTaskToolResult({
    ok: false,
    code: 'task_locked',
    error: 'The running task cannot be changed',
    queue: { state: 'RUNNING', activeTaskId: 7, pausedReason: null, running: true },
    events: [
      {
        id: 3,
        taskId: 7,
        kind: 'claimed',
        status: 'IN_PROGRESS',
        summary: 'Add the login form',
        originSessionId: null,
        createdAt: '2024-01-01T00:00:00.000Z'
      }
    ]
  });
  assert.equal(
    text,
    [
      'refused (task_locked): The running task cannot be changed',
      'queue RUNNING, loop running, active task 7',
      'events:',
      '- claimed task 7 IN_PROGRESS: Add the login form'
    ].join('\n')
  );
});

test('the digest names the change and the queue it left behind', () => {
  const text = formatTaskEventDigest(
    [
      {
        id: 4,
        taskId: 7,
        kind: 'settled',
        status: 'DONE',
        summary: 'Verification passed (1 command)',
        originSessionId: null,
        createdAt: '2024-01-01T00:00:00.000Z'
      }
    ],
    { state: 'RUNNING', activeTaskId: 8, pausedReason: null, running: true },
    { wakes: 3, maxWakes: 100, startedAt: '2024-01-01T00:00:00.000Z', maxDurationMs: 7_200_000 }
  );
  assert.equal(
    text,
    [
      '- settled task 7 DONE: Verification passed (1 command)',
      'queue RUNNING, task 8 running, wake 3 of 100'
    ].join('\n')
  );
});

test('the watch turns on, keeps the session alive, and turns off', async (t) => {
  const { call, store } = await harness(t, { pollMs: 5 });
  const on = await call('task_watch', { action: 'on' });
  assert.equal(on.details.ok, true);
  assert.equal(on.details.data.watching, true);
  assert.equal(store().getWatch()?.sessionId, 'manager-session');
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: 'manager-session' }), true);

  const off = await call('task_watch', { action: 'off' });
  assert.equal(off.details.data.watching, false);
  assert.equal(store().getWatch(), null);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: 'manager-session' }), false);
});

test('a second session cannot watch the queue at the same time', async (t) => {
  const { call } = await harness(t, { pollMs: 5 });
  await call('task_watch', { action: 'on' });

  const other = await call('task_watch', { action: 'on' }, 'other-session');
  assert.equal(other.details.ok, false);
  assert.equal(other.details.code, 'watch_held');
  assert.match(other.content[0].text, /other-session|manager-session/);
});

test('a settle wakes the watcher once with a follow-up digest', async (t) => {
  const { call, store, messages, project } = await harness(t, { pollMs: 5 });
  const created = await call('task_create', { title: 'One', cwd: project });
  const id = created.details.data.task.id;
  // A running queue keeps the watch alive after the digest.
  store().setQueueState({ state: 'RUNNING', pausedReason: null });
  await call('task_watch', { action: 'on' });

  // Another operator runs the task to completion.
  const claimed = store().claimNextPending('token-1', 'task-session');
  store().settleTask(claimed.id, 'token-1', {
    status: 'DONE',
    resultSummary: 'all good',
    exitCode: 0,
    sessionId: 'task-session'
  });

  assert.equal(await waitFor(() => messages.length > 0), true);
  const wake = messages[0];
  assert.equal(wake.message.customType, TASK_EVENT_CUSTOM_TYPE);
  assert.match(wake.message.content, /settled task \d+ DONE: all good/);
  assert.deepEqual(wake.options, { triggerTurn: true, deliverAs: 'followUp' });
  assert.match(wake.message.content, /wake 1 of 100/);
  assert.equal(store().getWatch()?.wakes, 1);
  assert.equal(id, claimed.id);
});

test('the watcher is not woken by its own calls', async (t) => {
  const { call, store, messages } = await harness(t, { pollMs: 5 });
  await call('task_watch', { action: 'on' });

  // The pause event carries this session as its origin.
  await call('task_control', { action: 'pause' });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(messages.length, 0);

  // Another session's pause is news.
  store().setQueueState({ state: 'PAUSED', pausedReason: 'review first' }, 'other-session');
  assert.equal(await waitFor(() => messages.length > 0), true);
  assert.match(messages[0].message.content, /queue PAUSED/);
});

test('reaching the wake budget ends the watch', async (t) => {
  const { call, store, messages, project } = await harness(t, { pollMs: 5, maxWakes: 1 });
  await call('task_create', { title: 'One', cwd: project });
  await call('task_watch', { action: 'on' });

  store().setQueueState({ state: 'RUNNING', pausedReason: null });
  assert.equal(await waitFor(() => messages.length >= 2), true);
  assert.match(messages[0].message.content, /queue RUNNING/);
  assert.match(messages[1].message.content, /Task watch ended \(wake budget\)/);
  assert.equal(store().getWatch(), null);
  assert.equal(messages[1].options.triggerTurn, true);
});

test('an idle queue ends the watch after its last digest', async (t) => {
  const { call, store, messages } = await harness(t, { pollMs: 5 });
  await call('task_watch', { action: 'on' });

  store().appendEvent({ kind: 'config', summary: 'queue defaults changed: model' });
  assert.equal(await waitFor(() => messages.length >= 2), true);
  assert.match(messages[0].message.content, /config: queue defaults changed: model/);
  assert.match(messages[1].message.content, /Task watch ended \(queue idle\)/);
  assert.equal(store().getWatch(), null);
});

test('shutting the session down releases the watch and its liveness', async (t) => {
  const { call, store, handlers, context } = await harness(t, { pollMs: 5 });
  await call('task_watch', { action: 'on' });
  assert.equal(store().getWatch()?.sessionId, 'manager-session');

  await handlers.get('session_shutdown')({ type: 'session_shutdown' }, context());
  assert.equal(store().getWatch(), null);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: 'manager-session' }), false);
});

test('a session start replays the backlog without spending a turn', async (t) => {
  const { store, handlers, context, messages } = await harness(t, { pollMs: 5 });
  store().setQueueState({ state: 'PAUSED', pausedReason: 'review first' }, 'other-session');

  await handlers.get('session_start')({ type: 'session_start', reason: 'startup' }, context());
  assert.equal(messages.length, 1);
  assert.match(messages[0].message.content, /Since this session last read the queue/);
  assert.match(messages[0].message.content, /PAUSED: review first/);
  assert.equal(messages[0].options, undefined);
  assert.equal(store().getEventCursor('manager-session'), store().lastEventId());

  // The cursor advanced: opening the session again says nothing new.
  await handlers.get('session_start')({ type: 'session_start', reason: 'startup' }, context());
  assert.equal(messages.length, 1);
});

test('a stale watch row from another session does not block a new one', async (t) => {
  const { call, store } = await harness(t, { pollMs: 5, maxDurationMs: 1_000 });
  store().setWatch('gone-session', new Date(Date.now() - 10_000).toISOString());
  const on = await call('task_watch', { action: 'on' });
  assert.equal(on.details.ok, true);
  assert.equal(store().getWatch()?.sessionId, 'manager-session');
});

test('a session that loses its watch row stops waking and frees its liveness', async (t) => {
  const { call, store, messages } = await harness(t, { pollMs: 5 });
  await call('task_watch', { action: 'on' });
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: 'manager-session' }), true);

  // A successor takes the single row over; this session must notice and stop.
  store().setWatch('successor-session');
  store().appendEvent({ kind: 'config', summary: 'queue defaults changed: model' });
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(messages.length, 0);
  assert.equal(store().getWatch()?.sessionId, 'successor-session');
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: 'manager-session' }), false);
});
