import { jsonResponse } from '@/lib/json-response';
import { configChangeSummary, readTaskConfig, writeTaskConfig } from '@/lib/tasks/config';
import { parseTaskConfigPatch } from '@/lib/tasks/config-fields';
import { noStore, readTaskBody, taskErrorResponse } from '@/lib/tasks/request';
import { getTaskStore } from '@/lib/tasks/store';

export const dynamic = 'force-dynamic';

/**
 * The queue's own defaults. Only the fields the board or the orchestrator can
 * edit are accepted; everything else in the file stays whatever the person
 * wrote there.
 */
export async function PUT(req: Request) {
  try {
    const patch = parseTaskConfigPatch(await readTaskBody(req));
    const before = readTaskConfig();
    const config = writeTaskConfig(patch);
    try {
      // The defaults live in a JSON file, so the event follows the write rather
      // than sharing a transaction with it.
      getTaskStore().appendEvent({ kind: 'config', summary: configChangeSummary(before, config) });
    } catch {
      // A missing event is not a failed configuration.
    }
    return jsonResponse(req, { config }, noStore());
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
