import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const root = await mkdtemp(path.join(os.tmpdir(), 'pi-web-global-agents-'));
const agentDir = path.join(root, 'agent');
const agentsPath = path.join(agentDir, 'AGENTS.md');
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { '@': process.cwd() },
  interopDefault: true,
  moduleCache: false
});
const { GET, PUT } = await jiti.import('./route.ts');

function get() {
  return GET();
}

function put(body, headers = { host: 'localhost', 'Content-Type': 'application/json' }) {
  return PUT(
    new Request('http://localhost/api/global-agents', {
      method: 'PUT',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
  );
}

test('creates, reads and replaces the global AGENTS.md', async () => {
  const initial = await get();
  assert.equal(initial.status, 200);
  const initialBody = await initial.json();
  assert.equal(initialBody.content, '');
  assert.equal(initialBody.exists, false);
  assert.equal(path.basename(initialBody.path), 'AGENTS.md');

  // The agent directory need not exist before the first save.
  const created = await put({ content: '# Global\n' });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.equal(createdBody.content, '# Global\n');
  assert.equal(createdBody.exists, true);
  assert.equal(path.basename(createdBody.path), 'AGENTS.md');
  assert.equal(await readFile(agentsPath, 'utf8'), '# Global\n');

  const reread = await (await get()).json();
  assert.equal(reread.content, '# Global\n');
  assert.equal(reread.exists, true);

  const emptied = await put({ content: '' });
  assert.equal(emptied.status, 200);
  assert.equal(await readFile(agentsPath, 'utf8'), '');
  const emptyBody = await (await get()).json();
  assert.equal(emptyBody.content, '');
  assert.equal(emptyBody.exists, true);

  await writeFile(agentsPath, 'existing\n');
  const replaced = await put({ content: 'new\n' });
  assert.equal(replaced.status, 200);
  assert.equal(await readFile(agentsPath, 'utf8'), 'new\n');
});

test('refuses invalid, oversized, foreign and non-JSON writes without touching the file', async () => {
  await writeFile(agentsPath, 'keep\n');

  assert.equal((await put({ content: 42 })).status, 400);
  assert.equal((await put('{')).status, 400);
  assert.equal(
    (await put({ content: 'x' }, { host: 'localhost', 'Content-Type': 'text/plain' })).status,
    415
  );
  assert.equal(
    (
      await put(
        { content: 'x' },
        { host: 'localhost', origin: 'https://evil.example', 'Content-Type': 'application/json' }
      )
    ).status,
    403
  );
  assert.equal((await put({ content: 'x'.repeat(1024 * 1024 + 1) })).status, 413);

  assert.equal(await readFile(agentsPath, 'utf8'), 'keep\n');
});
