import { json } from '@/server/http';
import { getTaskOrchestrator } from '@/lib/tasks/orchestrator';
import { noStore, readTaskBody, taskErrorResponse } from '@/lib/tasks/request';
import { TaskInputError } from '@/lib/tasks/queue';
import type { TaskMoveAction, TaskUpdateInput } from '@/lib/tasks/types';

function updateFromBody(body: Record<string, unknown>): TaskUpdateInput {
  const update: TaskUpdateInput = {};
  if (typeof body.title === 'string') update.title = body.title;
  if ('description' in body) {
    update.description = typeof body.description === 'string' ? body.description : null;
  }
  if (typeof body.cwd === 'string') update.cwd = body.cwd;
  if ('allow_ask_user' in body) {
    update.allowAskUser = typeof body.allow_ask_user === 'boolean' ? body.allow_ask_user : null;
  }
  if ('verify_commands' in body) {
    update.verifyCommands = Array.isArray(body.verify_commands)
      ? body.verify_commands.filter((entry): entry is string => typeof entry === 'string')
      : null;
  }
  return update;
}

/** `update`, `move`, `retry`, and `markDone`; every path respects the running guard. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId) || taskId <= 0) throw new TaskInputError('Invalid task id');
    const body = await readTaskBody(req);
    const action = body.action;
    const orchestrator = getTaskOrchestrator();
    const queue = orchestrator.queue;

    if (action === 'update') {
      const task = await queue.updateTask(taskId, updateFromBody(body));
      return json({ task }, noStore());
    }
    if (action === 'move') {
      const move: TaskMoveAction = {};
      if (body.direction === 'up' || body.direction === 'down') move.direction = body.direction;
      if (typeof body.position === 'number') move.position = body.position;
      const tasks = queue.moveTask(taskId, move);
      return json({ tasks }, noStore());
    }
    if (action === 'retry') {
      const task = queue.retryTask(taskId);
      return json({ task }, noStore());
    }
    if (action === 'markDone') {
      const note = typeof body.note === 'string' ? body.note : null;
      const task = queue.markDone(taskId, note);
      return json({ task }, noStore());
    }
    throw new TaskInputError('action must be update, move, retry, or markDone');
  } catch (error) {
    return taskErrorResponse(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId) || taskId <= 0) throw new TaskInputError('Invalid task id');
    getTaskOrchestrator().queue.deleteTask(taskId);
    return json({ deleted: taskId }, noStore());
  } catch (error) {
    return taskErrorResponse(error);
  }
}
