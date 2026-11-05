/**
 * The dedicated project a task manager session lives in.
 *
 * In Pie a project *is* a working directory: the sidebar groups by it and the
 * session list derives it from `cwd`. A real directory therefore gives the
 * orchestrator a stable group, a place for standing instructions, and an exact
 * predicate for tool injection, with no second notion of project identity.
 *
 * The directory sits inside the agent directory, beside `sessions/` and
 * `pie-tasks.db`, so it is never created inside a user's repository.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectIdentityKey } from '../project-identity';
import { getAgentDir } from '../session-reader';

export const TASK_MANAGER_DIR_NAME = 'task-manager';
export const TASK_MANAGER_PROJECT_LABEL = 'Task Manager';
export const TASK_MANAGER_AGENTS_FILE = 'AGENTS.md';

/**
 * Written once, then the user's to edit. It states the rules the tools cannot
 * enforce by themselves; the queue's own guards stay in code.
 */
export const TASK_MANAGER_AGENTS_TEMPLATE = `# Task Manager

This project is the operator's desk for Pie's serial task queue (\`docs/tasks.md\`
in the Pie checkout). You do not implement work here: you queue it, order it,
start it, and report what happened.

## Working rules

- One task at a time per project. Different projects may run concurrently;
  never start two tasks in the same project. A project is identified by its
  working directory: pass that cwd to task_control when starting, pausing,
  resuming, or aborting its queue.
- Every task needs a title that names the outcome, a \`cwd\` inside an allowed
  project directory, and verification commands when you know them. A task
  without a way to check itself will be reported back as blocked.
- A directory no Pi session has used is refused. When the user names one, pass
  \`authorizeCwd: true\` and the path is approved for later tasks too. Never set
  it to work around a refusal the user did not ask you to solve.
- \`task_delete\`, \`task_control: "markDone"\`, and \`task_control: "abort"\` need
  \`confirm: true\`. Clearing completed tasks also needs the project's cwd.
  Ask the user first unless they already told you to.
- A task's question belongs to the user. Relay it with its options and wait;
  answer it yourself only when the user said to, or when the task description
  you wrote already decides it.
- A settle wakes you with a digest. Reply with one short report: task, status,
  verification, and what runs next. Do not narrate the queue between tasks.
- These files are yours to read. Editing a file here never changes a task: tasks
  run in their own project directory.
`;

export interface TaskManagerProject {
  cwd: string;
  projectKey: string;
  /** True when the directory was created by this call. */
  created: boolean;
  /** True when this call wrote the default `AGENTS.md`. */
  agentsFileCreated: boolean;
}

export function taskManagerProjectDir(agentDir: string = getAgentDir()): string {
  return join(agentDir, TASK_MANAGER_DIR_NAME);
}

/** Whether a session's working directory is the task manager project. */
export function isTaskManagerProject(
  cwd: string,
  agentDir: string = getAgentDir(),
  platform: NodeJS.Platform = process.platform
): boolean {
  if (typeof cwd !== 'string' || !cwd.trim()) return false;
  return (
    projectIdentityKey(cwd, platform) === projectIdentityKey(taskManagerProjectDir(agentDir), platform)
  );
}

/**
 * Create the project on demand. `AGENTS.md` is written only when absent: it is
 * the user's file afterwards, and Pie never rewrites user data.
 */
export function ensureTaskManagerProject(agentDir: string = getAgentDir()): TaskManagerProject {
  const cwd = taskManagerProjectDir(agentDir);
  const created = !existsSync(cwd);
  mkdirSync(cwd, { recursive: true });

  let agentsFileCreated = false;
  const agentsPath = join(cwd, TASK_MANAGER_AGENTS_FILE);
  try {
    writeFileSync(agentsPath, TASK_MANAGER_AGENTS_TEMPLATE, { encoding: 'utf8', flag: 'wx' });
    agentsFileCreated = true;
  } catch (error) {
    // EEXIST is the normal case after the first open; anything else is reported
    // by the caller through the session's own error, never by failing the queue.
    if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
  }

  return {
    cwd,
    projectKey: projectIdentityKey(cwd),
    created,
    agentsFileCreated
  };
}
