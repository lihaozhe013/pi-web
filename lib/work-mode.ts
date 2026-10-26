import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { SessionEntry } from './types';

/**
 * How the conversation should behave, independent of which tools it may call.
 *
 * Only "Plan" needs storing: every other preset clears it. The value lives in the session log
 * so a resumed session keeps it, and the plan-mode extension reads it at prompt time.
 */
export type WorkMode = 'plan';

export const WORK_MODE_TYPE = 'pi-web:work-mode';

const WORK_MODES = new Set<string>(['plan'] satisfies WorkMode[]);

interface WorkModeData {
  version: 1;
  mode: WorkMode | null;
}

function parseWorkModeData(data: unknown): WorkMode | null | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
  const candidate = data as { version?: unknown; mode?: unknown };
  if (candidate.version !== 1) return undefined;
  if (candidate.mode === null) return null;
  if (typeof candidate.mode === 'string' && WORK_MODES.has(candidate.mode)) {
    return candidate.mode as WorkMode;
  }
  return undefined;
}

/**
 * The newest valid work mode, or undefined. The session log is append-only, so a later
 * `mode: null` entry retracts an earlier plan mode; an unreadable entry is skipped.
 */
export function readWorkMode(entries: readonly SessionEntry[]): WorkMode | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== 'custom' || entry.customType !== WORK_MODE_TYPE) continue;
    const mode = parseWorkModeData(entry.data);
    if (mode === undefined) continue;
    return mode ?? undefined;
  }
  return undefined;
}

export function validateWorkMode(value: unknown): WorkMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && WORK_MODES.has(value)) return value as WorkMode;
  throw new Error('mode must be "plan" or null');
}

export function appendWorkMode(sessionManager: SessionManager, mode: WorkMode | undefined): void {
  sessionManager.appendCustomEntry(WORK_MODE_TYPE, {
    version: 1,
    mode: mode ?? null
  } satisfies WorkModeData);
}

/** Persist a mode only when it differs from the newest entry, so a no-op never grows the log. */
export function syncWorkMode(
  sessionManager: SessionManager,
  entries: readonly SessionEntry[],
  mode: WorkMode | undefined
): void {
  if (readWorkMode(entries) === mode) return;
  appendWorkMode(sessionManager, mode);
}
