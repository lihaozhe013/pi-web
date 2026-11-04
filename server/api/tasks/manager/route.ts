import { json } from '@/server/http';
import { readSessionUiState, updateSessionUiState } from '@/lib/session-ui-state';
import {
  TASK_MANAGER_PROJECT_LABEL,
  ensureTaskManagerProject
} from '@/lib/tasks/manager-project';
import { noStore, taskErrorResponse } from '@/lib/tasks/request';


/**
 * Give the project a readable name once. A name the user set is kept: this is a
 * default, not a rename.
 */
async function ensureProjectLabel(projectKey: string): Promise<void> {
  try {
    if (readSessionUiState().projectNames?.[projectKey]) return;
    await updateSessionUiState({
      action: 'rename-project',
      projectKey,
      name: TASK_MANAGER_PROJECT_LABEL
    });
  } catch (error) {
    // A locked or unwritable UI state must not stop the project from existing.
    console.warn(
      `[pie] could not name the task manager project: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Ensure the task manager project exists and return the directory a session for
 * it should start in. The body is ignored: there is one project, not a choice.
 */
export async function POST() {
  try {
    const project = ensureTaskManagerProject();
    await ensureProjectLabel(project.projectKey);
    return json(project, noStore());
  } catch (error) {
    return taskErrorResponse(error);
  }
}
