import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import('./rpc-manager.ts');
const { createAskUserExtension } = await jiti.import('./ask-user-extension.ts');

async function startSession(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-web-ask-user-'));
  const faux = fauxProvider({ models: [{ id: 'faux-ask' }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, 'auth.json'),
    modelsPath: null,
    refreshOnCreate: false
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    extensionFactories: [createAskUserExtension()],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime,
    model: faux.getModel('faux-ask'),
    sessionManager: SessionManager.inMemory(dir),
    settingsManager,
    resourceLoader
  });
  const wrapper = new AgentSessionWrapper(session);
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  t.after(async () => {
    wrapper.destroy();
    await rm(dir, { recursive: true, force: true });
  });
  return { session, faux, wrapper, events };
}

// The transcript settles just after the prompt resolves, so read it through a poll.
async function toolResult(session, toolName) {
  for (let waited = 0; waited < 2_000; waited += 20) {
    const result = session.messages
      .filter((message) => message.role === 'toolResult' && message.toolName === toolName)
      .at(-1);
    if (result) return result;
    await delay(20);
  }
  assert.fail(`no ${toolName} tool result`);
}

async function waitForRequest(events, method) {
  for (let waited = 0; waited < 5_000; waited += 20) {
    const request = events.find((event) => event.method === method && !event.closed);
    if (request) return request;
    await delay(20);
  }
  assert.fail(`no ${method} request arrived`);
}

test('the ask_user dialog answer becomes the tool result', async (t) => {
  const { session, faux, wrapper, events } = await startSession(t);
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall('ask_user', { question: 'Which layout?', options: ['Sidebar', 'Tabs'] })],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage([fauxText('Using Tabs.')])
  ]);

  const sending = wrapper.send({ type: 'prompt', message: 'Ask me about the layout.' });
  const request = await waitForRequest(events, 'select');
  assert.equal(request.title, 'Which layout?');
  assert.deepEqual(request.options, ['Sidebar', 'Tabs', 'Write my own answer…']);

  await wrapper.send({ type: 'extension_ui_response', id: request.id, value: 'Tabs' });
  await sending;

  const result = await toolResult(session, 'ask_user');
  assert.notEqual(result.isError, true);
  assert.match(result.content.map((block) => block.text).join('\n'), /The user selected: Tabs/);
  assert.equal(result.details.answer, 'Tabs');
  assert.equal(result.details.answerSource, 'option');
});

test('dismissing the ask_user dialog is recorded as no answer', async (t) => {
  const { session, faux, wrapper, events } = await startSession(t);
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('ask_user', { question: 'Which layout?' })], {
      stopReason: 'toolUse'
    }),
    fauxAssistantMessage([fauxText('Waiting for your direction.')])
  ]);

  const sending = wrapper.send({ type: 'prompt', message: 'Ask me.' });
  const request = await waitForRequest(events, 'input');
  await wrapper.send({ type: 'extension_ui_response', id: request.id, cancelled: true });
  await sending;

  const result = await toolResult(session, 'ask_user');
  assert.match(result.content.map((block) => block.text).join('\n'), /dismissed the question/);
  assert.equal(result.details.answer, null);
  assert.equal(result.details.answerSource, null);
});
