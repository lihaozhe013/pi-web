import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  alias: { '@': process.cwd() },
  interopDefault: true,
  moduleCache: false
});
const { POST: deleteSessionsRoute } = await jiti.import('./delete/route.ts');
const { MAX_SESSION_DELETE_IDS } = await jiti.import('../../../lib/session-delete.ts');
const { PROJECT_DELETE_IDS_PER_REQUEST } = await jiti.import('../../../lib/sidebar-actions.ts');
const { invalidateSessionListCache, invalidateSessionPathCache } = await jiti.import(
  '../../../lib/session-reader.ts'
);
const { resetSessionUiStateCacheForTests } = await jiti.import('../../../lib/session-ui-state.ts');

const JSON_HEADERS = { host: 'localhost', 'Content-Type': 'application/json' };

function post(body, headers = JSON_HEADERS) {
  return deleteSessionsRoute(
    new Request('http://localhost/api/sessions/delete', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
  );
}

async function scratchAgentDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-web-delete-route-'));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousRegistry = globalThis.__piSessions;
  process.env.PI_CODING_AGENT_DIR = dir;
  globalThis.__piSessions = new Map();
  invalidateSessionListCache();
  resetSessionUiStateCacheForTests();
  const ids = [];
  t.after(async () => {
    globalThis.__piSessions = previousRegistry;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    for (const id of ids) invalidateSessionPathCache(id);
    invalidateSessionListCache();
    resetSessionUiStateCacheForTests();
    await rm(dir, { recursive: true, force: true });
  });
  const sessionsDir = join(dir, 'sessions', '--work-alpha--');
  await mkdir(sessionsDir, { recursive: true });
  return { dir, sessionsDir, ids };
}

test('a delete request must be a trusted JSON list of session ids, at most one part', async (t) => {
  await scratchAgentDir(t);
  assert.equal(
    MAX_SESSION_DELETE_IDS,
    PROJECT_DELETE_IDS_PER_REQUEST,
    "the sidebar's parts fit the route"
  );

  assert.equal(
    (await post({ ids: ['a'] }, { host: 'localhost', 'Content-Type': 'text/plain' })).status,
    415
  );
  assert.equal(
    (await post({ ids: ['a'] }, { host: 'evil.example', 'Content-Type': 'application/json' }))
      .status,
    403
  );
  for (const body of [
    '{',
    [],
    { ids: [] },
    { ids: 'a' },
    { ids: ['../a'] },
    { ids: [1] },
    { ids: Array.from({ length: MAX_SESSION_DELETE_IDS + 1 }, (_, index) => `s${index}`) }
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(typeof (await response.json()).error, 'string');
  }
  // Ids already gone delete nothing and say so.
  const response = await post({ ids: ['nobody', 'nobody'] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: [], missing: ['nobody'], running: [] });
});
