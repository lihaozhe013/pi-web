import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';

const { createGoalExtension } = await createJiti(import.meta.url).import('./goal-extension.ts');

test('goal continues after a run and stops on an explicit report', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-web-goal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const faux = fauxProvider({ models: [{ id: 'faux-goal' }] });
  const runtime = await ModelRuntime.create({
    authPath: join(dir, 'auth.json'),
    modelsPath: null,
    refreshOnCreate: false
  });
  runtime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager: settings,
    extensionFactories: [createGoalExtension()],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime: runtime,
    model: faux.getModel('faux-goal'),
    sessionManager: SessionManager.inMemory(dir),
    settingsManager: settings,
    resourceLoader: loader
  });
  try {
    await session.bindExtensions({});
    faux.setResponses([
      fauxAssistantMessage([fauxText('Work remains.')]),
      fauxAssistantMessage([
        fauxToolCall('report_goal', { status: 'completed', evidence: 'Verified the result.' })
      ]),
      fauxAssistantMessage([fauxText('Finished and verified.')])
    ]);
    await session.prompt('/goal start Check the result');
    for (let i = 0; i < 100; i++) {
      const latest = session.sessionManager
        .getBranch()
        .filter((e) => e.type === 'custom' && e.customType === 'pi-web:goal')
        .at(-1);
      if (latest?.data.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await session.waitForIdle();
    const entries = session.sessionManager
      .getBranch()
      .filter((e) => e.type === 'custom' && e.customType === 'pi-web:goal');
    assert.equal(entries.at(-1)?.data.status, 'completed');
    assert.equal(entries.at(-1)?.data.continuations, 1);
  } finally {
    session.dispose();
  }
});

test('a rejected startup stays paused until its own prompt reaches the agent', async () => {
  const handlers = {};
  const branch = [];
  let command;
  let sent;
  const pi = {
    on: (name, handler) => {
      handlers[name] = handler;
    },
    registerCommand: (_name, spec) => {
      command = spec.handler;
    },
    registerTool: () => {},
    appendEntry: (customType, data) => branch.push({ type: 'custom', customType, data }),
    sendMessage: (message, options) => {
      sent = { ...message, ...options };
    }
  };
  createGoalExtension().factory(pi);
  const ctx = {
    sessionManager: { getBranch: () => branch },
    ui: { setStatus: () => {}, notify: () => {} }
  };
  await command('start Example', ctx);
  assert.equal(branch.at(-1).data.status, 'paused');
  // The run starts from a hidden custom message, not from something the person typed.
  assert.equal(sent.display, false);
  assert.equal(sent.triggerTurn, true);
  assert.equal(sent.customType, 'pi-web:goal');
  handlers.before_agent_start({ messageType: 'user', prompt: 'unrelated' }, ctx);
  assert.equal(branch.at(-1).data.status, 'paused');
  handlers.before_agent_start({ messageType: 'custom', message: { customType: 'other' } }, ctx);
  assert.equal(branch.at(-1).data.status, 'paused');
  handlers.before_agent_start({ messageType: 'custom', message: sent }, ctx);
  assert.equal(branch.at(-1).data.status, 'active');
});

test('restoring an active goal pauses it instead of running unattended', () => {
  const handlers = {};
  const branch = [
    {
      type: 'custom',
      customType: 'pi-web:goal',
      data: {
        version: 1,
        objective: 'Example',
        status: 'active',
        continuations: 0,
        startedAt: Date.now(),
        baselineTokens: 0
      }
    }
  ];
  const pi = {
    on: (name, handler) => {
      handlers[name] = handler;
    },
    registerCommand: () => {},
    registerTool: () => {},
    appendEntry: (customType, data) => branch.push({ type: 'custom', customType, data })
  };
  createGoalExtension().factory(pi);
  const ctx = { sessionManager: { getBranch: () => branch }, ui: { setStatus: () => {} } };
  handlers.session_start({}, ctx);
  assert.equal(branch.at(-1).data.status, 'paused');
});

test('continuation limit pauses the goal at the settlement boundary', () => {
  const handlers = {};
  const branch = [
    {
      type: 'custom',
      customType: 'pi-web:goal',
      data: {
        version: 1,
        objective: 'Example',
        status: 'active',
        continuations: 5,
        startedAt: Date.now(),
        baselineTokens: 0
      }
    }
  ];
  const pi = {
    on: (name, handler) => {
      handlers[name] = handler;
    },
    registerCommand: () => {},
    registerTool: () => {}
  };
  createGoalExtension().factory(pi);
  const ctx = {
    sessionManager: { getBranch: () => branch },
    ui: { setStatus: () => {} },
    hasPendingMessages: () => false
  };
  const result = handlers.agent_before_settle({ outcome: 'completed', continue: false }, ctx);
  assert.equal(result.continue, undefined);
  assert.equal(result.entries[0].data.status, 'paused');
  assert.equal(result.entries[0].data.reason, 'continuations');
});

test('token, time, and error outcomes stop rather than continue', () => {
  const handlers = {};
  const goal = {
    version: 1,
    objective: 'Example',
    status: 'active',
    continuations: 0,
    startedAt: Date.now(),
    baselineTokens: 0
  };
  const branch = [{ type: 'custom', customType: 'pi-web:goal', data: goal }];
  const pi = {
    on: (name, handler) => {
      handlers[name] = handler;
    },
    registerCommand: () => {},
    registerTool: () => {}
  };
  createGoalExtension().factory(pi);
  const ctx = {
    sessionManager: { getBranch: () => branch },
    ui: { setStatus: () => {} },
    hasPendingMessages: () => false
  };
  const decide = (outcome = 'completed') =>
    handlers.agent_before_settle({ outcome, continue: false }, ctx);
  assert.equal(decide('error').entries[0].data.reason, 'error');
  assert.equal(decide('aborted').entries[0].data.reason, 'aborted');
  goal.startedAt = Date.now() - 30 * 60_000;
  assert.equal(decide().entries[0].data.reason, 'time');
  goal.startedAt = Date.now();
  branch.push({ type: 'message', message: { role: 'assistant', usage: { totalTokens: 200_000 } } });
  assert.equal(decide().entries[0].data.reason, 'tokens');
});

test('an aborted run pauses the goal even without an assistant message', () => {
  const handlers = {};
  const branch = [
    {
      type: 'custom',
      customType: 'pi-web:goal',
      data: {
        version: 1,
        objective: 'Example',
        status: 'active',
        continuations: 0,
        startedAt: Date.now(),
        baselineTokens: 0
      }
    }
  ];
  const pi = {
    on: (name, handler) => {
      handlers[name] = handler;
    },
    registerCommand: () => {},
    registerTool: () => {},
    appendEntry: (customType, data) => branch.push({ type: 'custom', customType, data })
  };
  createGoalExtension().factory(pi);
  const ctx = { sessionManager: { getBranch: () => branch }, ui: { setStatus: () => {} } };
  handlers.agent_settled({ aborted: true }, ctx);
  assert.equal(branch.at(-1).data.status, 'paused');
  assert.equal(branch.at(-1).data.reason, 'Stopped by user.');
});

function fakeHost(options) {
  const handlers = {};
  const branch = [];
  let command;
  let sent;
  const pi = {
    on: (name, handler) => {
      handlers[name] = handler;
    },
    registerCommand: (_name, spec) => {
      command = spec.handler;
    },
    registerTool: () => {},
    appendEntry: (customType, data) => branch.push({ type: 'custom', customType, data }),
    sendMessage: (message, sendOptions) => {
      sent = { ...message, ...sendOptions };
    }
  };
  createGoalExtension(options).factory(pi);
  const ctx = {
    sessionManager: { getBranch: () => branch },
    ui: { setStatus: () => {}, notify: () => {} },
    isIdle: () => true,
    abort: () => {}
  };
  return { handlers, branch, ctx, run: command, sent: () => sent };
}

const deep = { maxContinuations: 10, maxTokens: 500_000, maxElapsedMs: 60 * 60_000 };

test('a new goal starts at the stored default depth', async () => {
  const host = fakeHost({ readDefaultLimits: () => deep });
  await host.run('start Example', host.ctx);
  assert.deepEqual(host.branch.at(-1).data.limits, deep);
});

test('flags override the stored depth field by field', async () => {
  const host = fakeHost({ readDefaultLimits: () => deep });
  await host.run('start --turns 3 --minutes 5 Example', host.ctx);
  assert.deepEqual(host.branch.at(-1).data.limits, {
    maxContinuations: 3,
    maxTokens: deep.maxTokens,
    maxElapsedMs: 5 * 60_000
  });
});

test('a stored depth out of range falls back instead of running unbounded', async () => {
  const host = fakeHost({
    readDefaultLimits: () => ({ maxContinuations: 0, maxTokens: 0, maxElapsedMs: 0 })
  });
  await host.run('start Example', host.ctx);
  assert.deepEqual(host.branch.at(-1).data.limits, {
    maxContinuations: 5,
    maxTokens: 200_000,
    maxElapsedMs: 30 * 60_000
  });
});

test('depth changes without a run, and never while the goal runs', async () => {
  const host = fakeHost({ readDefaultLimits: () => deep });
  await host.run('start Example', host.ctx);
  host.branch.push({
    type: 'custom',
    customType: 'pi-web:goal',
    data: { ...host.branch.at(-1).data, status: 'paused' }
  });
  await host.run('limits --turns 2', host.ctx);
  assert.deepEqual(host.branch.at(-1).data.limits, {
    maxContinuations: 2,
    maxTokens: deep.maxTokens,
    maxElapsedMs: deep.maxElapsedMs
  });
  assert.equal(host.branch.at(-1).data.status, 'paused');

  host.branch.push({
    type: 'custom',
    customType: 'pi-web:goal',
    data: { ...host.branch.at(-1).data, status: 'active' }
  });
  const before = host.branch.length;
  await host.run('limits --turns 4', host.ctx);
  assert.equal(host.branch.length, before);
});

test('a goal stops at its own depth, not the built-in one', () => {
  const host = fakeHost();
  host.branch.push({
    type: 'custom',
    customType: 'pi-web:goal',
    data: {
      version: 1,
      objective: 'Example',
      status: 'active',
      continuations: 1,
      startedAt: Date.now(),
      baselineTokens: 0,
      limits: { maxContinuations: 1, maxTokens: 10_000, maxElapsedMs: 60_000 }
    }
  });
  const result = host.handlers.agent_before_settle(
    { outcome: 'completed', continue: false },
    { ...host.ctx, hasPendingMessages: () => false }
  );
  assert.equal(result.continue, undefined);
  assert.equal(result.entries[0].data.reason, 'continuations');

  host.branch.push({
    type: 'message',
    message: { role: 'assistant', usage: { totalTokens: 10_000 } }
  });
  host.branch.push({
    type: 'custom',
    customType: 'pi-web:goal',
    data: { ...host.branch.at(-2).data, continuations: 0 }
  });
  const tokenStop = host.handlers.agent_before_settle(
    { outcome: 'completed', continue: false },
    { ...host.ctx, hasPendingMessages: () => false }
  );
  assert.equal(tokenStop.entries[0].data.reason, 'tokens');
});
