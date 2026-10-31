import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import('./rpc-manager.ts');
const { GOAL_STATUS_KEY, formatGoalBridge } = await jiti.import('./goal-driver.ts');

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

const userEntry = (text) => ({ type: 'message', message: { role: 'user', content: text } });
const goalEntry = (status, objective = 'Ship the parser fix') => ({
  type: 'custom',
  customType: 'pi-better-goal',
  data: { version: 1, kind: 'set', source: 'command', goal: { status, objective }, at: 1 }
});

/**
 * A wrapper over the parts of an SDK session the goal bridge reads: the branch
 * the package writes, the commands the package registers, and the prompt
 * dispatch an extension command goes through.
 */
function setup(t, { entries = [], goalCommand = true } = {}) {
  const prompts = [];
  const listeners = new Set();
  const branch = [...entries];
  const inner = {
    sessionId: 'goal-bridge-test',
    sessionFile: '',
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    isIdle: true,
    pendingMessageCount: 0,
    sessionManager: {
      getCwd: () => '/tmp',
      getBranch: () => branch,
      getEntries: () => branch,
      getSessionName: () => undefined
    },
    agent: { state: {}, abort() {} },
    abortRetry() {},
    abortCompaction() {},
    abortBranchSummary() {},
    dispose() {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prompt: async (text) => {
      prompts.push(text);
    },
    extensionRunner: {
      getRegisteredCommands: () =>
        goalCommand
          ? [
              {
                invocationName: 'goal',
                description: 'Goal',
                sourceInfo: { path: '/tmp/pi-better-goal/src/index.ts' }
              }
            ]
          : []
    }
  };
  const wrapper = new AgentSessionWrapper(inner);
  const statuses = [];
  wrapper.onEvent((event) => {
    if (event.method === 'setStatus')
      statuses.push({ key: event.statusKey, text: event.statusText });
  });
  t.after(() => wrapper.destroy());
  return {
    wrapper,
    inner,
    branch,
    prompts,
    statuses,
    emit: (event) => {
      for (const listener of listeners) listener(event);
    }
  };
}

const goalStatus = (statuses) =>
  statuses.filter((item) => item.key === GOAL_STATUS_KEY).at(-1)?.text;

async function open(session) {
  session.wrapper.start();
  session.wrapper.beginExtensionBinding();
  await session.wrapper.waitUntilReady();
  await nextTurn();
}

test('the bridge reports the package and the goal it wrote', async (t) => {
  const session = setup(t, { entries: [userEntry('Ship it'), goalEntry('active')] });
  await open(session);
  assert.equal(
    goalStatus(session.statuses),
    formatGoalBridge({
      available: true,
      goal: { status: 'active', objective: 'Ship the parser fix' }
    })
  );

  // A package that is not installed leaves the goal entry unavailable, not wrong.
  const other = setup(t, { goalCommand: false });
  await open(other);
  assert.equal(goalStatus(other.statuses), '{"available":false}');
});

test('the package entry is republished as it is appended', async (t) => {
  const session = setup(t);
  await open(session);
  assert.equal(goalStatus(session.statuses), '{"available":true}');

  // What the SDK emits when the package calls appendEntry.
  session.branch.push(goalEntry('paused'));
  session.emit({ type: 'entry_appended', entry: session.branch.at(-1) });
  await nextTurn();
  assert.equal(
    goalStatus(session.statuses),
    formatGoalBridge({
      available: true,
      goal: { status: 'paused', objective: 'Ship the parser fix' }
    })
  );

  // Records the package writes about its own machinery say nothing about the goal.
  session.branch.push({
    type: 'custom',
    customType: 'pi-better-goal',
    data: { version: 1, kind: 'continuation-state', state: {} }
  });
  session.emit({ type: 'entry_appended', entry: session.branch.at(-1) });
  await nextTurn();
  assert.match(goalStatus(session.statuses), /"status":"paused"/);
});

test('each command becomes the command the package parses', async (t) => {
  const session = setup(t, { entries: [userEntry('Add CSV export')] });
  await open(session);

  // A start without an objective falls back to the message the person last wrote.
  assert.equal(await session.wrapper.send({ type: 'goal', action: 'start' }), null);
  // An objective typed into the dialog is used as written, and trimmed.
  await session.wrapper.send({ type: 'goal', action: 'start', objective: '  Ship the parser  ' });
  await session.wrapper.send({ type: 'goal', action: 'pause' });
  await session.wrapper.send({ type: 'goal', action: 'resume' });
  await session.wrapper.send({ type: 'goal', action: 'complete' });
  await session.wrapper.send({ type: 'goal', action: 'clear' });
  assert.deepEqual(session.prompts, [
    '/goal Add CSV export',
    '/goal Ship the parser',
    '/goal pause',
    '/goal resume',
    '/goal complete',
    '/goal clear'
  ]);
});

test('an objective longer than the package accepts is cut, not refused', async (t) => {
  const session = setup(t);
  await open(session);
  await session.wrapper.send({ type: 'goal', action: 'start', objective: 'x'.repeat(9000) });
  assert.equal(session.prompts.at(-1), `/goal ${'x'.repeat(4000)}`);
});

test('a start with nothing to work on, or without a package, is refused', async (t) => {
  const empty = setup(t);
  await open(empty);
  await assert.rejects(
    () => empty.wrapper.send({ type: 'goal', action: 'start' }),
    /Send a message or write an objective before starting a goal/
  );
  await assert.rejects(
    () => empty.wrapper.send({ type: 'goal', action: 'explode' }),
    /Unknown goal action/
  );
  assert.deepEqual(empty.prompts, []);

  const missing = setup(t, { goalCommand: false, entries: [userEntry('Add CSV export')] });
  await open(missing);
  await assert.rejects(
    () => missing.wrapper.send({ type: 'goal', action: 'pause' }),
    /No goal extension is installed/
  );
  assert.deepEqual(missing.prompts, []);
});

test('a goal an earlier process left active is paused when the session opens', async (t) => {
  const session = setup(t, { entries: [userEntry('Ship it'), goalEntry('active')] });
  await open(session);

  // The pause is the package's own command, not an entry written behind its back.
  assert.deepEqual(session.prompts, ['/goal pause']);
});

test('a completed or paused goal is left exactly as it was restored', async (t) => {
  for (const status of ['complete', 'paused']) {
    const session = setup(t, { entries: [goalEntry(status)] });
    await open(session);
    assert.deepEqual(session.prompts, [], status);
  }
});
