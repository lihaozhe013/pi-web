import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

// The project lives in the agent directory, so point it at a temporary one
// before the modules that resolve it load.
const agentDir = await mkdtemp(join(tmpdir(), 'pie-task-manager-'));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import('@/app/api/tasks/manager/route.ts');
const { ensureTaskManagerProject, isTaskManagerProject, taskManagerProjectDir, TASK_MANAGER_AGENTS_TEMPLATE } =
  await jiti.import('@/lib/tasks/manager-project.ts');
const { readSessionUiState, updateSessionUiState } = await jiti.import('@/lib/session-ui-state.ts');

const projectDir = join(agentDir, 'task-manager');

test.after(async () => {
  await rm(agentDir, { recursive: true, force: true });
});

function post() {
  return POST(new Request('http://local/api/tasks/manager', { method: 'POST' }));
}

test('the route creates the project and its instructions once', async () => {
  const first = await post();
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.cwd, projectDir);
  assert.equal(body.created, true);
  assert.equal(body.agentsFileCreated, true);
  assert.ok(body.projectKey);

  const instructions = await readFile(join(projectDir, 'AGENTS.md'), 'utf8');
  assert.equal(instructions, TASK_MANAGER_AGENTS_TEMPLATE);
  assert.match(instructions, /One task at a time/);

  // Reopening keeps the user's file exactly as it is.
  const edited = `${TASK_MANAGER_AGENTS_TEMPLATE}\nAsk before starting anything long.\n`;
  await writeFile(join(projectDir, 'AGENTS.md'), edited, 'utf8');

  const second = await post();
  assert.equal(second.status, 200);
  const again = await second.json();
  assert.equal(again.created, false);
  assert.equal(again.agentsFileCreated, false);
  assert.equal(await readFile(join(projectDir, 'AGENTS.md'), 'utf8'), edited);
});

test('the sidebar gets one default name and keeps a name the user chose', async () => {
  const project = ensureTaskManagerProject();
  assert.equal(readSessionUiState().projectNames?.[project.projectKey], 'Task Manager');

  await updateSessionUiState({
    action: 'rename-project',
    projectKey: project.projectKey,
    name: 'My Queue'
  });
  const response = await post();
  assert.equal(response.status, 200);
  assert.equal(readSessionUiState().projectNames?.[project.projectKey], 'My Queue');
});

test('only the project directory counts as the manager project', () => {
  const project = ensureTaskManagerProject();
  assert.equal(isTaskManagerProject(project.cwd), true);
  assert.equal(isTaskManagerProject(`${project.cwd}/`), true);
  assert.equal(isTaskManagerProject(agentDir), false);
  assert.equal(isTaskManagerProject(process.cwd()), false);
  assert.equal(isTaskManagerProject(''), false);
  assert.equal(isTaskManagerProject(project.cwd, agentDir, 'win32'), true);
});

test('the project directory is inside the agent directory', () => {
  assert.equal(taskManagerProjectDir(agentDir), projectDir);
});
