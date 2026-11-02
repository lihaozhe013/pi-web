import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const agentDir = await mkdtemp(join(tmpdir(), 'pie-task-manager-ext-'));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createTaskManagerExtension, TASK_MANAGER_EXTENSION_NAME } = await jiti.import(
  '@/lib/task-manager-extension.ts'
);
const { TASK_MANAGER_TOOL_NAMES, formatTaskToolResult } = await jiti.import(
  '@/lib/tasks/agent-tools.ts'
);
const { resetTaskStore } = await jiti.import('@/lib/tasks/store.ts');
const { resetTaskOrchestrator } = await jiti.import('@/lib/tasks/orchestrator.ts');
const { allowFileRoot } = await jiti.import('@/lib/allowed-roots.ts');

test.after(async () => {
  resetTaskOrchestrator();
  resetTaskStore();
  await rm(agentDir, { recursive: true, force: true });
});

/** The extension only needs `registerTool` from Pi to hand back its definitions. */
function loadExtension() {
  const tools = new Map();
  const pi = {
    registerTool: (tool) => tools.set(tool.name, tool),
    on: () => () => {},
    appendEntry: () => {},
    setSessionName: () => {}
  };
  const extension = createTaskManagerExtension();
  assert.equal(extension.name, TASK_MANAGER_EXTENSION_NAME);
  assert.equal(extension.hidden, true);
  extension.factory(pi);
  return tools;
}

function context(cwd, sessionId = 'manager-session') {
  return {
    cwd,
    hasUI: false,
    sessionManager: { getSessionId: () => sessionId, getCwd: () => cwd }
  };
}

test('every queue tool is registered as a sequential direct tool', () => {
  const tools = loadExtension();
  assert.deepEqual([...tools.keys()].sort(), [...TASK_MANAGER_TOOL_NAMES].sort());
  for (const [name, tool] of tools) {
    assert.equal(tool.executionMode, 'sequential', `${name} must not run beside another tool`);
    assert.ok(tool.description.length > 20, `${name} needs a description`);
    assert.ok(tool.promptGuidelines?.length, `${name} needs guidelines`);
  }
});

test('a tool call answers with the queue and the data', async () => {
  resetTaskOrchestrator();
  resetTaskStore();
  const tools = loadExtension();
  const project = join(agentDir, 'project');
  await rm(project, { recursive: true, force: true });
  await mkdir(project, { recursive: true });
  allowFileRoot(project);

  const created = await tools.get('task_create').execute(
    'call-1',
    { title: 'Add the login form', cwd: project },
    undefined,
    undefined,
    context(agentDir)
  );
  const createdText = created.content[0].text;
  assert.match(createdText, /^ok/m);
  assert.match(createdText, /queue IDLE/);
  assert.equal(created.details.ok, true);
  assert.equal(created.details.data.task.title, 'Add the login form');

  const listed = await tools.get('task_list').execute(
    'call-2',
    {},
    undefined,
    undefined,
    context(agentDir)
  );
  assert.match(listed.content[0].text, /Add the login form/);
  assert.equal(listed.details.data.tasks.length, 1);
  // The create call already consumed its own event.
  assert.deepEqual(listed.details.events, []);
});

test('a refusal is a result, not an exception', async () => {
  const tools = loadExtension();
  const result = await tools.get('task_delete').execute(
    'call-3',
    { id: 999 },
    undefined,
    undefined,
    context(agentDir)
  );
  assert.equal(result.details.ok, false);
  assert.equal(result.details.code, 'confirmation_required');
  assert.match(result.content[0].text, /^refused \(confirmation_required\)/);
});

test('the formatter leads with the outcome and lists the news', () => {
  const text = formatTaskToolResult({
    ok: false,
    code: 'task_locked',
    error: 'The running task cannot be changed',
    queue: { state: 'RUNNING', activeTaskId: 7, pausedReason: null, running: true },
    events: [
      {
        id: 3,
        taskId: 7,
        kind: 'claimed',
        status: 'IN_PROGRESS',
        summary: 'Add the login form',
        originSessionId: null,
        createdAt: '2024-01-01T00:00:00.000Z'
      }
    ]
  });
  assert.equal(
    text,
    [
      'refused (task_locked): The running task cannot be changed',
      'queue RUNNING, loop running, active task 7',
      'events:',
      '- claimed task 7 IN_PROGRESS: Add the login form'
    ].join('\n')
  );
});
