import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { createJiti } from 'jiti';

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), 'pi-web-context-limit-route-'));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { '@': process.cwd() },
  interopDefault: true,
  moduleCache: false
});
const { GET, PUT } = await jiti.import('./route.ts');
const settingsPath = join(testAgentDir, 'pi-web-model-settings.json');

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function put(body) {
  return new Request('http://localhost/api/models/context-limit', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Host: 'localhost' },
    body: JSON.stringify(body)
  });
}

test('a missing file reads as no limit', async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { limit: null });
});

test('a save persists the limit and clearing removes it', async () => {
  const saved = await PUT(put({ limit: 350000 }));
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { limit: 350000 });
  assert.match(await readFile(settingsPath, 'utf8'), /"contextWindowLimit": 350000/);

  let read = await GET();
  assert.deepEqual(await read.json(), { limit: 350000 });

  const cleared = await PUT(put({ limit: null }));
  assert.equal(cleared.status, 200);
  assert.deepEqual(await cleared.json(), { limit: null });
  const doc = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal('contextWindowLimit' in doc, false);

  read = await GET();
  assert.deepEqual(await read.json(), { limit: null });
});

test('invalid limits are refused without writing the file', async () => {
  await PUT(put({ limit: 350000 }));
  const before = await readFile(settingsPath, 'utf8');

  for (const limit of [0, -5, 'abc', true]) {
    const response = await PUT(put({ limit }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /positive whole number/);
  }

  const missing = await PUT(put({}));
  assert.equal(missing.status, 400);

  const broken = new Request('http://localhost/api/models/context-limit', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '{'
  });
  assert.equal((await PUT(broken)).status, 400);

  assert.equal(await readFile(settingsPath, 'utf8'), before);
  const read = await GET();
  assert.deepEqual(await read.json(), { limit: 350000 });
});
