import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

// Approving a directory writes it beside the agent state, which must not be the
// real one during a test.
const approvalsDir = await mkdtemp(path.join(os.tmpdir(), 'pie-cwd-validate-approvals-'));
process.env.PI_CODING_AGENT_DIR = approvalsDir;
test.after(() => rm(approvalsDir, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, {
  alias: { '@': process.cwd() },
  interopDefault: true,
  moduleCache: false
});
const { POST } = await jiti.import('./route.ts');
const { projectIdentityKey } = await jiti.import('../../../../lib/project-identity.ts');

test('validated cwd responses group by the selected directory, even inside a Git repository', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pie-cwd-validate-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', cwd]);
  const selected = path.join(cwd, 'nested');
  await mkdir(selected);

  const response = await POST(
    new Request('http://localhost/api/cwd/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: selected })
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    cwd: selected,
    projectRoot: selected,
    projectKey: projectIdentityKey(selected)
  });
});

test('an approved cwd is visible to the paths that read the allow-list', async (t) => {
  const selected = await mkdtemp(path.join(os.tmpdir(), 'pie-cwd-approve-'));
  t.after(() => rm(selected, { recursive: true, force: true }));

  const response = await POST(
    new Request('http://localhost/api/cwd/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: selected })
    })
  );
  assert.equal(response.status, 200);

  const { getAllowedFileRoots } = await jiti.import('../../../../lib/file-access.ts');
  assert.ok((await getAllowedFileRoots()).has(selected.replaceAll('\\', '/')));

  // The queue consults the same roots, so a task can now be queued there.
  const { TaskStore } = await jiti.import('../../../../lib/tasks/store.ts');
  const { TaskQueue } = await jiti.import('../../../../lib/tasks/queue.ts');
  const store = new TaskStore(path.join(approvalsDir, 'pie-tasks.db'));
  t.after(() => store.close());
  const queue = new TaskQueue(store);
  assert.equal((await queue.createTask({ title: 'Queued', cwd: selected })).cwd, selected);
});
