/**
 * Small HTTP helpers shared by the task routes: a bounded JSON body and one
 * mapping from queue errors to the documented status codes.
 */
import { jsonResponse } from '../json-response';
import { OrchestratorConflictError } from './orchestrator';
import { TaskInputError, TaskLockedError, TaskMoveError, TaskNotFoundError } from './queue';

export const TASK_BODY_LIMIT_BYTES = 1_048_576;

export async function readTaskBody(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > TASK_BODY_LIMIT_BYTES) {
    throw new TaskInputError('The request body is too large');
  }
  const text = await request.text();
  if (text.length > TASK_BODY_LIMIT_BYTES) {
    throw new TaskInputError('The request body is too large');
  }
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TaskInputError('The request body is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TaskInputError('The request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function taskErrorResponse(request: Request, error: unknown): Response {
  if (error instanceof TaskInputError) {
    return jsonResponse(request, { error: error.message, code: error.code }, { status: 400 });
  }
  if (error instanceof TaskNotFoundError) {
    return jsonResponse(request, { error: error.message, code: error.code }, { status: 404 });
  }
  if (error instanceof TaskLockedError) {
    return jsonResponse(request, { error: error.message, code: error.code }, { status: 409 });
  }
  if (error instanceof TaskMoveError) {
    return jsonResponse(request, { error: error.message, code: error.code }, { status: 409 });
  }
  if (error instanceof OrchestratorConflictError) {
    return jsonResponse(request, { error: error.message, code: error.code }, { status: 409 });
  }
  const message = error instanceof Error ? error.message : String(error);
  return jsonResponse(request, { error: message, code: 'internal_error' }, { status: 500 });
}

export function noStore(): { headers: Record<string, string> } {
  return { headers: { 'Cache-Control': 'no-store' } };
}
