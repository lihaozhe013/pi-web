import { jsonResponse } from '@/lib/json-response';
import { readTaskConfig } from '@/lib/tasks/config';
import { getTaskOrchestrator } from '@/lib/tasks/orchestrator';
import { noStore, readTaskBody, taskErrorResponse } from '@/lib/tasks/request';
import type { TaskCreateInput } from '@/lib/tasks/types';

export const dynamic = 'force-dynamic';

/** The board's whole poll payload: tasks, recent runs, loop state, and defaults. */
export async function GET(req: Request) {
  try {
    const orchestrator = getTaskOrchestrator();
    return jsonResponse(
      req,
      {
        tasks: orchestrator.queue.listTasks(),
        runs: orchestrator.queue.listRuns(),
        orchestrator: orchestrator.status(),
        config: readTaskConfig(),
        // The one watch row, so the board can say a session is listening.
        watch: orchestrator.queue.store.getWatch()
      },
      noStore()
    );
  } catch (error) {
    return taskErrorResponse(req, error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readTaskBody(req);
    const input: TaskCreateInput = {
      title: typeof body.title === 'string' ? body.title : '',
      description: typeof body.description === 'string' ? body.description : null,
      cwd: typeof body.cwd === 'string' ? body.cwd : '',
      allowAskUser: typeof body.allow_ask_user === 'boolean' ? body.allow_ask_user : null,
      verifyCommands: Array.isArray(body.verify_commands)
        ? body.verify_commands.filter((entry): entry is string => typeof entry === 'string')
        : null
    };
    const orchestrator = getTaskOrchestrator();
    const task = await orchestrator.queue.createTask(input);
    return jsonResponse(req, { task }, { status: 201, ...noStore() });
  } catch (error) {
    return taskErrorResponse(req, error);
  }
}
