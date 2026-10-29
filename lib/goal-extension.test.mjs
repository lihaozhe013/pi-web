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
    sendUserMessage: (message) => {
      sent = message;
    }
  };
  createGoalExtension().factory(pi);
  const ctx = {
    sessionManager: { getBranch: () => branch },
    ui: { setStatus: () => {}, notify: () => {} }
  };
  await command('start Example', ctx);
  assert.equal(branch.at(-1).data.status, 'paused');
  handlers.before_agent_start({ messageType: 'user', prompt: 'unrelated' }, ctx);
  assert.equal(branch.at(-1).data.status, 'paused');
  handlers.before_agent_start({ messageType: 'user', prompt: sent }, ctx);
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
