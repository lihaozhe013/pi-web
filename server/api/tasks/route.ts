import { json } from '@/server/http';
import { readTaskConfig } from '@/lib/tasks/config';
import { getTaskOrchestrator } from '@/lib/tasks/orchestrator';
import { noStore, readTaskBody, taskErrorResponse } from '@/lib/tasks/request';
import type { TaskCreateInput } from '@/lib/tasks/types';


/** The board's whole poll payload: tasks, recent runs, loop state, and defaults. */
export async function GET() {
  try {
    const orchestrator = getTaskOrchestrator();
    return json({
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
    return taskErrorResponse(error);
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
    return json({ task }, { status: 201, ...noStore() });
  } catch (error) {
    return taskErrorResponse(error);
  }
}
