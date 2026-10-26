import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';

const root = realpathSync(await mkdtemp(join(tmpdir(), 'pi-web-model-thinking-')));
const agentDir = join(root, 'agent');
const cwd = join(root, 'project');
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousOffline = process.env.PI_OFFLINE;
process.env.PI_CODING_AGENT_DIR = agentDir;
// The custom provider below is enough to resolve the model; nothing here needs a network.
process.env.PI_OFFLINE = '1';

await mkdir(agentDir, { recursive: true });
await mkdir(cwd, { recursive: true });
await writeFile(
  join(agentDir, 'models.json'),
  JSON.stringify({
    providers: {
      acme: {
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'sk-test',
        api: 'openai-completions',
        models: [{ id: 'one', name: 'Acme One' }]
      }
    }
  })
);
await writeFile(join(agentDir, 'settings.json'), '{}');

const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() } });
const { allowFileRoot } = await jiti.import('../../../../lib/file-access.ts');
const { PUT } = await jiti.import('./route.ts');
allowFileRoot(root);

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousOffline === undefined) delete process.env.PI_OFFLINE;
  else process.env.PI_OFFLINE = previousOffline;
  await rm(root, { recursive: true, force: true });
});

function save(body) {
  return PUT(
    new Request('http://localhost/api/models/thinking', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', host: 'localhost' },
      body: JSON.stringify({ cwd, ...body })
    })
  );
}

async function savedSettings() {
  return JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8'));
}

test('saves a reasoning level for one model', async () => {
  const response = await save({
    provider: 'acme',
    modelId: 'one',
    thinkingLevel: 'high'
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await savedSettings(), { modelThinkingLevels: { 'acme/one': 'high' } });
});

test('null removes the entry instead of writing a level', async () => {
  const response = await save({ provider: 'acme', modelId: 'one', thinkingLevel: null });
  assert.equal(response.status, 200);
  assert.equal('modelThinkingLevels' in (await savedSettings()), false);
});

test('rejects an unknown level before touching settings', async () => {
  const response = await save({ provider: 'acme', modelId: 'one', thinkingLevel: 'turbo' });
  assert.equal(response.status, 400);
  assert.equal('modelThinkingLevels' in (await savedSettings()), false);
});

test('refuses to save a model the selector cannot offer', async () => {
  const response = await save({ provider: 'acme', modelId: 'missing', thinkingLevel: 'high' });
  assert.equal(response.status, 404);
  assert.equal('modelThinkingLevels' in (await savedSettings()), false);
});

test('a project value for the same model refuses the global write', async () => {
  await mkdir(join(cwd, '.pi'), { recursive: true });
  await writeFile(
    join(cwd, '.pi', 'settings.json'),
    JSON.stringify({ modelThinkingLevels: { 'acme/one': 'low' } })
  );
  // A project settings file is only read for a trusted project.
  new ProjectTrustStore(agentDir).set(cwd, true);
  try {
    const response = await save({ provider: 'acme', modelId: 'one', thinkingLevel: 'high' });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).reason, 'project-scope');
    assert.equal('modelThinkingLevels' in (await savedSettings()), false);
  } finally {
    await rm(join(cwd, '.pi'), { recursive: true, force: true });
  }
});
