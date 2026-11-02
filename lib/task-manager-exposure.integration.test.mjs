import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const agentDir = await mkdtemp(join(tmpdir(), 'pie-task-manager-exposure-'));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { startRpcSession } = await jiti.import('@/lib/rpc-manager.ts');
const { ensureTaskManagerProject } = await jiti.import('@/lib/tasks/manager-project.ts');
const { TASK_MANAGER_TOOL_NAMES } = await jiti.import('@/lib/tasks/agent-tools.ts');

test.after(async () => {
  await rm(agentDir, { recursive: true, force: true });
});

test('the manager project forces the full loadout and exposes the queue tools', async (t) => {
  const project = ensureTaskManagerProject(agentDir);
  // A Chat-only request must not win here: the tools are injected, not selected.
  const { session } = await startRpcSession('__new__task-manager', '', project.cwd, {
    toolNames: []
  });
  t.after(() => session.shutdown());

  assert.equal(session.isChatOnly(), false);
  const names = session.inner.getActiveToolNames();
  for (const name of TASK_MANAGER_TOOL_NAMES) {
    assert.ok(names.includes(name), `${name} should be active in the task manager project`);
  }
  // The coding preset is untouched: the tools ride beside it.
  for (const name of ['read', 'bash', 'edit', 'write']) {
    assert.ok(names.includes(name), `${name} should still be active`);
  }
});

test('another project never sees the queue tools', async (t) => {
  const project = join(agentDir, 'another-project');
  await mkdir(project, { recursive: true });
  const { session } = await startRpcSession('__new__other-project', '', project, { toolNames: [] });
  t.after(() => session.shutdown());

  assert.equal(session.isChatOnly(), true);
  const names = session.inner.getActiveToolNames();
  assert.equal(names.includes('task_list'), false);
});
