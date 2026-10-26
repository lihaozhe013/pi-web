import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
const { createPlanModeExtension } = await jiti.import('./plan-mode-extension.ts');
const { createAskUserExtension } = await jiti.import('./ask-user-extension.ts');
const { appendWorkMode } = await jiti.import('./work-mode.ts');

// A plan selection pins the read-only tools, but an extension can carry a write tool beside
// them; the guard, not the selection, is what must stop it.
const TOOLS = ['read', 'grep', 'find', 'ls', 'write'];

async function createSession(dir, { planMode = false } = {}) {
  const faux = fauxProvider({ models: [{ id: 'faux-plan' }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, 'auth.json'),
    modelsPath: null,
    refreshOnCreate: false
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory();
  const sessionManager = SessionManager.inMemory(dir);
  if (planMode) appendWorkMode(sessionManager, 'plan');
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    extensionFactories: [createAskUserExtension(), createPlanModeExtension()],
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
    model: faux.getModel('faux-plan'),
    sessionManager,
    settingsManager,
    resourceLoader,
    tools: TOOLS
  });
  return { session, faux };
}

function toolResult(session, toolName) {
  return session.messages
    .filter((message) => message.role === 'toolResult' && message.toolName === toolName)
    .at(-1);
}

test('plan mode blocks a write tool the selection carried and tells the model why', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-web-plan-block-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { session, faux } = await createSession(dir, { planMode: true });

  try {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write', { path: 'notes.md', content: 'x' })]),
      fauxAssistantMessage([fauxText('Here is the plan.')])
    ]);

    await session.prompt('Add a notes file.');

    const result = toolResult(session, 'write');
    assert.ok(result, 'the tool call is recorded');
    assert.equal(result.isError, true);
    assert.match(result.content.map((block) => block.text).join('\n'), /Plan mode is read-only/);
    assert.equal(existsSync(join(dir, 'notes.md')), false, 'nothing was written');
    assert.match(session.agent.state.systemPrompt, /Plan mode is on/);
  } finally {
    session.dispose();
  }
});

test('leaving plan mode restores writes in the same session', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-web-plan-exit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { session, faux } = await createSession(dir, { planMode: true });

  try {
    appendWorkMode(session.sessionManager, undefined);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write', { path: 'notes.md', content: 'written' })]),
      fauxAssistantMessage([fauxText('Done.')])
    ]);

    await session.prompt('Now add it.');

    const result = toolResult(session, 'write');
    assert.ok(result);
    assert.notEqual(result.isError, true);
    assert.match(await readFile(join(dir, 'notes.md'), 'utf8'), /written/);
    assert.doesNotMatch(session.agent.state.systemPrompt, /Plan mode is on/);
  } finally {
    session.dispose();
  }
});

test('a session without plan mode keeps its writes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-web-plan-off-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { session, faux } = await createSession(dir);

  try {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write', { path: 'notes.md', content: 'plain' })]),
      fauxAssistantMessage([fauxText('Done.')])
    ]);

    await session.prompt('Add a notes file.');

    assert.notEqual(toolResult(session, 'write').isError, true);
    assert.equal(existsSync(join(dir, 'notes.md')), true);
  } finally {
    session.dispose();
  }
});
