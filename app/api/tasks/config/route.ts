import { jsonResponse } from '@/lib/json-response';
import { configChangeSummary, readTaskConfig, writeTaskConfig } from '@/lib/tasks/config';
import { TASK_INSTRUCTIONS_MAX_LENGTH } from '@/lib/tasks/defaults';
import { noStore, readTaskBody, taskErrorResponse } from '@/lib/tasks/request';
import { TaskInputError } from '@/lib/tasks/queue';
import { getTaskStore } from '@/lib/tasks/store';
import type { TaskConfig } from '@/lib/tasks/types';

export const dynamic = 'force-dynamic';

/** Milliseconds for a numeric field; `null` means "no limit". */
function timeoutMs(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TaskInputError(`${field} must be a positive number of milliseconds, or null`);
  }
  return Math.round(value);
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new TaskInputError(`${field} must be a boolean`);
  return value;
}

/** Standing instructions are free text; an empty string clears them. */
function instructionsField(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new TaskInputError(`${field} must be a string`);
  const instructions = value.replaceAll('\0', '').trim();
  if (instructions.length > TASK_INSTRUCTIONS_MAX_LENGTH) {
    throw new TaskInputError(`${field} is limited to ${TASK_INSTRUCTIONS_MAX_LENGTH} characters`);
  }
  return instructions;
}

function commandListField(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new TaskInputError(`${field} must be a list of strings`);
  }
  const commands = value.map((entry) => entry.trim()).filter(Boolean);
  if (commands.some((command) => command.length > 2_000)) {
    throw new TaskInputError(`${field} entries are limited to 2000 characters`);
  }
  if (commands.length > 20) throw new TaskInputError(`${field} is limited to 20 entries`);
  return commands;
}

/**
 * The queue's own defaults. Only the fields the board can edit are accepted;
 * everything else in the file stays whatever the person wrote there.
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
    if ('verifyCommands' in body) {
      patch.verifyCommands = commandListField(body.verifyCommands, 'verifyCommands');
    }
    if ('verifyTimeoutMs' in body) {
      patch.verifyTimeoutMs = timeoutMs(body.verifyTimeoutMs, 'verifyTimeoutMs');
    }
    if ('taskTimeoutMs' in body) {
      patch.taskTimeoutMs = timeoutMs(body.taskTimeoutMs, 'taskTimeoutMs');
    }
    if ('allowAskUser' in body) {
      patch.allowAskUser = booleanField(body.allowAskUser, 'allowAskUser');
    }
    if ('instructions' in body) {
      patch.instructions = instructionsField(body.instructions, 'instructions');
    }
    if (Object.keys(patch).length === 0) {
      throw new TaskInputError('No queue default to change');
    }
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
