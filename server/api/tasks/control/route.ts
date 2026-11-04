import { json } from '@/server/http';
import { getTaskOrchestrator } from '@/lib/tasks/orchestrator';
import { noStore, readTaskBody, taskErrorResponse } from '@/lib/tasks/request';
import { TaskInputError } from '@/lib/tasks/queue';

/** `start`, `pause`, `resume`, `abort`. Start resolves when the queue drains, so it is not awaited. */
export async function POST(req: Request) {
  try {
    const body = await readTaskBody(req);
    const action = body.action;
    const orchestrator = getTaskOrchestrator();
    if (action === 'start') {
      void orchestrator
        .start()
        .catch(() => {
          // The stored queue state already says why the loop could not start.
        })
        .finally(() => {});
      return json({ orchestrator: orchestrator.status() }, noStore());
    }
    if (action === 'pause') {
      const status = await orchestrator.pause();
      return json({ orchestrator: status }, noStore());
    }
    if (action === 'resume') {
      const status = await orchestrator.resume();
      return json({ orchestrator: status }, noStore());
    }
    if (action === 'abort') {
      const status = await orchestrator.abort();
      return json({ orchestrator: status }, noStore());
    }
    throw new TaskInputError('action must be start, pause, resume, or abort');
  } catch (error) {
    return taskErrorResponse(error);
  }
}
