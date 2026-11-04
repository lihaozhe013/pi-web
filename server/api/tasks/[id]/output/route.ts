import { json } from '@/server/http';
import { getTaskOrchestrator } from '@/lib/tasks/orchestrator';
import { noStore, taskErrorResponse } from '@/lib/tasks/request';
import { TaskNotFoundError } from '@/lib/tasks/queue';

/** The live tail of the active task, read from the in-memory buffer only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const taskId = Number(id);
    const orchestrator = getTaskOrchestrator();
    const task = orchestrator.queue.getTask(taskId);
    if (!task) throw new TaskNotFoundError();
    const status = orchestrator.status();
    return json({
        taskId,
        running: status.activeTaskId === taskId,
        output: orchestrator.output(taskId),
        activity: status.activeTaskId === taskId ? status.activity : null
      },
      noStore()
    );
  } catch (error) {
    return taskErrorResponse(error);
  }
}
