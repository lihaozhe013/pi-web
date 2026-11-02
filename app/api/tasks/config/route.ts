import { jsonResponse } from '@/lib/json-response';
import { readTaskConfig, writeTaskConfig } from '@/lib/tasks/config';
import { noStore, readTaskBody, taskErrorResponse } from '@/lib/tasks/request';
import { TaskInputError } from '@/lib/tasks/queue';
import type { TaskConfig } from '@/lib/tasks/types';

export const dynamic = 'force-dynamic';

/**
 * The queue's own defaults. Only the fields the board can change are accepted;
 * the rest of the file stays whatever the person wrote there.
 */
export async function PUT(req: Request) {
  try {
    const body = await readTaskBody(req);
    const patch: Partial<TaskConfig> = {};
    if ('model' in body) {
      if (body.model === null) patch.model = null;
      else if (body.model && typeof body.model === 'object' && !Array.isArray(body.model)) {
        const record = body.model as Record<string, unknown>;
        const provider = typeof record.provider === 'string' ? record.provider.trim() : '';
        const modelId = typeof record.modelId === 'string' ? record.modelId.trim() : '';
        if (!provider || !modelId) {
          throw new TaskInputError('model needs both a provider and a modelId');
        }
        patch.model = { provider, modelId };
      } else {
        throw new TaskInputError('model must be { provider, modelId } or null');
      }
    }
    if (Object.keys(patch).length === 0) {
      throw new TaskInputError('No queue default to change');
    }
    return jsonResponse(req, { config: writeTaskConfig(patch) }, noStore());
  } catch (error) {
    return taskErrorResponse(req, error);
  }
}

export async function GET(req: Request) {
  try {
    return jsonResponse(req, { config: readTaskConfig() }, noStore());
  } catch (error) {
    return taskErrorResponse(req, error);
  }
}
