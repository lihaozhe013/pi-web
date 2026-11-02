import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

// Every route resolves the agent directory from the environment; point it at a
// temporary directory before the queue modules load their singleton.
const agentDir = await mkdtemp(join(tmpdir(), 'pie-task-api-'));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST } = await jiti.import('@/app/api/tasks/route.ts');
const { PATCH, DELETE } = await jiti.import('@/app/api/tasks/[id]/route.ts');
const { POST: control } = await jiti.import('@/app/api/tasks/control/route.ts');
const { POST: answer } = await jiti.import('@/app/api/tasks/[id]/answer/route.ts');
const { GET: output } = await jiti.import('@/app/api/tasks/[id]/output/route.ts');
const { PUT: config } = await jiti.import('@/app/api/tasks/config/route.ts');
const { getTaskStore, resetTaskStore } = await jiti.import('@/lib/tasks/store.ts');
const { resetTaskOrchestrator } = await jiti.import('@/lib/tasks/orchestrator.ts');
const { allowFileRoot } = await jiti.import('@/lib/allowed-roots.ts');

const databasePath = join(agentDir, 'pie-tasks.db');

// Each test starts from an empty database; one claimed row would otherwise make
// every later claim fail its serial guard.
test.beforeEach(async () => {
  resetTaskOrchestrator();
  resetTaskStore();
  for (const suffix of ['', '-wal', '-shm']) {
    await rm(`${databasePath}${suffix}`, { force: true });
  }
  allowFileRoot(process.cwd());
});

test.after(async () => {
  resetTaskOrchestrator();
  resetTaskStore();
  await rm(agentDir, { recursive: true, force: true });
});

function jsonRequest(url, body, method = 'POST') {
  return new Request(`http://local${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function params(id) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function insertTask(overrides = {}) {
  const store = getTaskStore();
  return store.insertTask({
    title: overrides.title ?? 'A task',
    description: null,
    cwd: overrides.cwd ?? process.cwd(),
    rank: store.nextRank(),
    allowAskUser: null,
    verifyCommands: null,
    now: new Date().toISOString()
  });
}

test('GET returns the board payload with no-store caching', async () => {
  const response = await GET(new Request('http://local/api/tasks'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.ok(Array.isArray(body.tasks));
  assert.ok(Array.isArray(body.runs));
  assert.equal(body.orchestrator.state, 'IDLE');
  assert.equal(body.orchestrator.running, false);
  assert.deepEqual(body.config.verifyCommands, []);
  assert.equal(body.config.allowAskUser, false);
});

test('POST validates the body and keeps a valid task', async () => {
  const invalid = await POST(jsonRequest('/api/tasks', { title: '', cwd: process.cwd() }));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'invalid_input');

  const created = await POST(
    jsonRequest('/api/tasks', {
      title: 'Write the queue',
      description: 'docs',
      cwd: process.cwd(),
      verify_commands: ['true']
    })
  );
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.task.title, 'Write the queue');
  assert.deepEqual(body.task.verifyCommands, ['true']);
});

test('PATCH update and DELETE are refused with task_locked while running', async () => {
  const task = insertTask();
  getTaskStore().claimNextPending('token-1', 'session-1');

  const locked = await PATCH(
    jsonRequest(`/api/tasks/${task.id}`, { action: 'update', title: 'Changed' }, 'PATCH'),
    params(task.id)
  );
  assert.equal(locked.status, 409);
  assert.equal((await locked.json()).code, 'task_locked');

  const removed = await DELETE(jsonRequest(`/api/tasks/${task.id}`), params(task.id));
  assert.equal(removed.status, 409);
  assert.equal((await removed.json()).code, 'task_locked');
});

test('PATCH moves the pending segment and retries a blocked task', async () => {
  const store = getTaskStore();
  const one = insertTask({ title: 'One' });
  const two = insertTask({ title: 'Two' });
  const three = insertTask({ title: 'Three' });

  void one.id;
  const moved = await PATCH(
    jsonRequest(`/api/tasks/${three.id}`, { action: 'move', position: 1 }, 'PATCH'),
    params(three.id)
  );
  assert.equal(moved.status, 200);
  const tasks = (await moved.json()).tasks;
  const pendingTitles = tasks
    .filter((task) => task.status === 'PENDING')
    .slice(-3)
    .map((task) => task.title);
  assert.deepEqual(pendingTitles, ['Three', 'One', 'Two']);

  // Make one task blocked the way the loop would: claim, then settle.
  const claimed = store.claimNextPending('token-retry', 'session-retry');
  store.settleTask(claimed.id, 'token-retry', {
    status: 'BLOCKED',
    resultSummary: 'gate failed',
    exitCode: 0,
    sessionId: 'session-retry'
  });
  const retried = await PATCH(
    jsonRequest(`/api/tasks/${claimed.id}`, { action: 'retry' }, 'PATCH'),
    params(claimed.id)
  );
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).task.status, 'PENDING');

  const unknown = await PATCH(
    jsonRequest(`/api/tasks/${two.id}`, { action: 'explode' }, 'PATCH'),
    params(two.id)
  );
  assert.equal(unknown.status, 400);
});

test('DELETE removes a finished task and 404s an unknown one', async () => {
  const task = insertTask({ title: 'Delete me' });
  const removed = await DELETE(jsonRequest(`/api/tasks/${task.id}`), params(task.id));
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).deleted, task.id);

  const missing = await DELETE(jsonRequest('/api/tasks/99999'), params(99999));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'task_not_found');
});

test('answering without a pending question is a conflict', async () => {
  const task = insertTask({ title: 'No question' });
  const response = await answer(
    jsonRequest(`/api/tasks/${task.id}/answer`, { answer: 'Yes' }),
    params(task.id)
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'no_pending_question');
});

test('the output route serves the in-memory tail and 404s an unknown task', async () => {
  const task = insertTask({ title: 'Idle task' });
  const idle = await output(
    new Request(`http://local/api/tasks/${task.id}/output`),
    params(task.id)
  );
  assert.equal(idle.status, 200);
  const body = await idle.json();
  assert.equal(body.running, false);
  assert.equal(body.output, '');

  const missing = await output(new Request('http://local/api/tasks/99999/output'), params(99999));
  assert.equal(missing.status, 404);
});

test('control validates its action', async () => {
  const response = await control(jsonRequest('/api/tasks/control', { action: 'explode' }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'invalid_input');

  const paused = await control(jsonRequest('/api/tasks/control', { action: 'pause' }));
  assert.equal(paused.status, 200);
  assert.equal((await paused.json()).orchestrator.state, 'PAUSED');
});

test('the config route stores the queue model and can clear it', async () => {
  const saved = await config(
    jsonRequest(
      '/api/tasks/config',
      { model: { provider: 'anthropic', modelId: 'claude-sonnet-4' } },
      'PUT'
    )
  );
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).config.model, {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4'
  });

  // The board's next poll carries the choice.
  const board = await GET(new Request('http://local/api/tasks'));
  assert.deepEqual((await board.json()).config.model, {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4'
  });

  const cleared = await config(jsonRequest('/api/tasks/config', { model: null }, 'PUT'));
  assert.equal((await cleared.json()).config.model, null);

  const invalid = await config(
    jsonRequest('/api/tasks/config', { model: { provider: 'anthropic' } }, 'PUT')
  );
  assert.equal(invalid.status, 400);
});

test('the config route accepts the rest of the queue defaults and rejects bad numbers', async () => {
  const saved = await config(
    jsonRequest(
      '/api/tasks/config',
      {
        verifyCommands: [' bun run typecheck ', ''],
        verifyTimeoutMs: 120_000,
        taskTimeoutMs: 1_800_000,
        allowAskUser: true,
        instructions: '  Commit when the task is done.  '
      },
      'PUT'
    )
  );
  assert.equal(saved.status, 200);
  const savedConfig = (await saved.json()).config;
  assert.deepEqual(savedConfig.verifyCommands, ['bun run typecheck']);
  assert.equal(savedConfig.verifyTimeoutMs, 120_000);
  assert.equal(savedConfig.taskTimeoutMs, 1_800_000);
  assert.equal(savedConfig.allowAskUser, true);
  assert.equal(savedConfig.instructions, 'Commit when the task is done.');
  // A field the board did not send keeps its stored value.
  assert.deepEqual(savedConfig.model, null);

  const badTimeout = await config(jsonRequest('/api/tasks/config', { taskTimeoutMs: 0 }, 'PUT'));
  assert.equal(badTimeout.status, 400);
  assert.equal((await badTimeout.json()).code, 'invalid_input');

  const badInstructions = await config(
    jsonRequest('/api/tasks/config', { instructions: 42 }, 'PUT')
  );
  assert.equal(badInstructions.status, 400);

  // "No limit" is a stored null, not a missing field.
  const unlimited = await config(
    jsonRequest('/api/tasks/config', { taskTimeoutMs: null, verifyTimeoutMs: null }, 'PUT')
  );
  assert.equal(unlimited.status, 200);
  const unlimitedConfig = (await unlimited.json()).config;
  assert.equal(unlimitedConfig.taskTimeoutMs, null);
  assert.equal(unlimitedConfig.verifyTimeoutMs, null);
});
