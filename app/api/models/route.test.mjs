import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { promisify } from 'node:util';
import { ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';

const execFileAsync = promisify(execFile);

const root = realpathSync(await mkdtemp(join(tmpdir(), 'pi-web-models-route-')));
const agentDir = join(root, 'agent');
const repo = join(root, 'repo');
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousOffline = process.env.PI_OFFLINE;
process.env.PI_CODING_AGENT_DIR = agentDir;
// The list is served from the SDK's own data and the models.json below, so the route
// never reaches for the network here.
process.env.PI_OFFLINE = '1';

await mkdir(agentDir, { recursive: true });
await writeFile(
  join(agentDir, 'settings.json'),
  JSON.stringify({ modelThinkingLevels: { 'acme/one': 'high' } })
);
await writeFile(
  join(agentDir, 'models.json'),
  JSON.stringify(
    {
      providers: {
        acme: {
          baseUrl: 'https://example.invalid/v1',
          apiKey: 'sk-test',
          api: 'openai-completions',
          models: [{ id: 'one', name: 'Acme One' }]
        }
      }
    },
    null,
    2
  )
);

async function initRepo(name) {
  const path = join(root, name);
  await execFileAsync('git', ['init', path]);
  return path;
}
await initRepo('repo');

const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() } });
const { allowFileRoot } = await jiti.import('../../../lib/file-access.ts');
const { invalidateModelsCache } = await jiti.import('../../../lib/models-cache.ts');
const { GET } = await jiti.import('./route.ts');
const { PUT: saveDefault } = await jiti.import('./default/route.ts');
const { PUT: saveThinking } = await jiti.import('./thinking/route.ts');
const { GET: getEnabled, PUT: saveEnabled } = await jiti.import('./enabled/route.ts');
allowFileRoot(repo);

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousOffline === undefined) delete process.env.PI_OFFLINE;
  else process.env.PI_OFFLINE = previousOffline;
  await rm(root, { recursive: true, force: true });
});

async function models(cwd) {
  const response = await GET(
    new Request(`http://localhost/api/models?cwd=${encodeURIComponent(cwd)}`, {
      headers: { host: 'localhost' }
    })
  );
  return { status: response.status, body: await response.json() };
}

test('a per-model reasoning default is listed for the settings panel', async () => {
  const listed = await models(repo);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.modelThinkingLevels, { 'acme/one': 'high' });
});

test('global model settings work without a project and ignore agent directory project settings', async () => {
  await mkdir(join(agentDir, '.pi'), { recursive: true });
  await writeFile(
    join(agentDir, '.pi', 'settings.json'),
    JSON.stringify({ enabledModels: ['missing/*'], defaultThinkingLevel: 'low' })
  );
  const url = 'http://10.42.0.1:30141/api/models';
  const headers = { host: '10.42.0.1:30141' };
  const listed = await GET(new Request(url, { headers }));
  assert.equal(listed.status, 200);
  const body = await listed.json();
  assert.deepEqual(
    body.modelList.map((model) => `${model.provider}:${model.id}`),
    ['acme:one']
  );
  assert.notEqual(body.savedDefaultThinkingLevel, 'low');

  await mkdir(join(repo, '.pi'), { recursive: true });
  await writeFile(
    join(repo, '.pi', 'settings.json'),
    JSON.stringify({ defaultThinkingLevel: 'low' })
  );
  new ProjectTrustStore(agentDir).set(repo, true);
  invalidateModelsCache();
  const project = await models(repo);
  assert.equal(project.status, 200);
  assert.equal(project.body.savedDefaultThinkingLevel, 'low');
  assert.notEqual(
    (await (await GET(new Request(url, { headers }))).json()).savedDefaultThinkingLevel,
    'low'
  );

  const put = (route, payload) =>
    route(
      new Request(url, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    );
  assert.equal(
    (await put(saveDefault, { provider: 'acme', modelId: 'one', thinkingLevel: 'high' })).status,
    200
  );
  assert.equal(
    (await put(saveThinking, { provider: 'acme', modelId: 'one', thinkingLevel: 'low' })).status,
    200
  );
  const enabled = await getEnabled(new Request(url, { headers }));
  assert.equal(enabled.status, 200);
  assert.equal((await enabled.json()).scope, 'global');
  assert.equal((await put(saveEnabled, { op: 'clear' })).status, 200);
  const unknown = await initRepo('global-test-unknown');
  assert.equal((await put(saveDefault, { cwd: unknown, thinkingLevel: 'high' })).status, 403);
  assert.equal(
    (
      await put(saveThinking, {
        cwd: unknown,
        provider: 'acme',
        modelId: 'one',
        thinkingLevel: 'high'
      })
    ).status,
    403
  );
  assert.equal((await put(saveEnabled, { cwd: unknown, op: 'clear' })).status, 403);
  const saved = JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8'));
  assert.equal(saved.defaultProvider, 'acme');
  assert.equal(saved.defaultThinkingLevel, 'high');
  assert.equal(saved.modelThinkingLevels['acme/one'], 'low');
  const projectSettings = JSON.parse(
    await readFile(join(agentDir, '.pi', 'settings.json'), 'utf8')
  );
  assert.equal(projectSettings.defaultThinkingLevel, 'low');
});
