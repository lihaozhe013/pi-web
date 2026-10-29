import type { ExtensionStatusItem } from './types';

/**
 * Goal state is written by the goal extension as session custom entries and read
 * back from the branch, so forks and tree navigation see the goal at that point.
 * The same snapshot travels to the browser as the extension status text, encoded
 * as JSON: the composer's Goal button needs structured state, not a sentence.
 */
export const GOAL_ENTRY_TYPE = 'pi-web:goal';
export const GOAL_STATUS_KEY = 'pi-web-goal';

export type GoalStatus = 'active' | 'paused' | 'completed' | 'blocked';

export interface GoalSnapshot {
  version: 1;
  objective: string;
  status: GoalStatus;
  /** Automatic continuations used in the current run of the goal. */
  continuations: number;
  startedAt: number;
  /** Token total when the goal started or last resumed; usage is counted from here. */
  baselineTokens: number;
  reason?: string;
}

const STATUSES: readonly GoalStatus[] = ['active', 'paused', 'completed', 'blocked'];

function isStatus(value: unknown): value is GoalStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

function validGoal(value: unknown): GoalSnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const goal = value as Partial<GoalSnapshot>;
  if (goal.version !== 1) return undefined;
  if (typeof goal.objective !== 'string' || !goal.objective.trim()) return undefined;
  if (!isStatus(goal.status)) return undefined;
  if (!Number.isFinite(goal.continuations) || !Number.isFinite(goal.startedAt)) return undefined;
  if (!Number.isFinite(goal.baselineTokens)) return undefined;
  return {
    version: 1,
    objective: goal.objective,
    status: goal.status,
    continuations: Math.max(0, Math.floor(goal.continuations as number)),
    startedAt: goal.startedAt as number,
    baselineTokens: Math.max(0, Math.floor(goal.baselineTokens as number)),
    ...(typeof goal.reason === 'string' && goal.reason ? { reason: goal.reason } : {})
  };
}

interface BranchEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

/** The latest goal on the branch. An entry with `data: null` retracts an earlier goal. */
export function readGoalFromEntries(entries: readonly BranchEntry[]): GoalSnapshot | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== 'custom' || entry.customType !== GOAL_ENTRY_TYPE) continue;
    if (entry.data === null) return undefined;
    return validGoal(entry.data);
  }
  return undefined;
}

/**
 * The status text always carries a value: `null` says the live session has no goal,
 * which is different from a session that never started a runtime and has no status.
 */
export function formatGoalStatus(goal: GoalSnapshot | undefined): string {
  return JSON.stringify(goal ?? null);
}

export interface GoalStatusReport {
  /** A live session published its goal status; without it, only saved state is known. */
  known: boolean;
  goal?: GoalSnapshot;
}

export function readGoalStatus(statuses: readonly ExtensionStatusItem[]): GoalStatusReport {
  const item = statuses.find((status) => status.key === GOAL_STATUS_KEY);
  if (!item) return { known: false };
  try {
    const parsed: unknown = JSON.parse(item.text);
    if (parsed === null) return { known: true };
    const goal = validGoal(parsed);
    return goal ? { known: true, goal } : { known: false };
  } catch {
    return { known: false };
  }
}

export function isGoalRunning(goal: GoalSnapshot | undefined): boolean {
  return goal?.status === 'active';
}

/** The command the composer's Goal dialog sends, or null when nothing needs to change. */
export function goalCommand(
  current: GoalSnapshot | undefined,
  draft: { objective: string; status: GoalStatus }
): string | null {
  const objective = draft.objective.trim();
  if (objective.length > 4000) return null;
  if (!current) return objective ? `/goal start ${objective}` : null;
  if (!objective) return null;
  // A running goal keeps the objective it started with; changing it needs a pause first.
  if (objective !== current.objective) {
    return current.status === 'active' ? null : `/goal start ${objective}`;
  }
  if (draft.status === current.status) return null;
  if (draft.status === 'active') return '/goal resume';
  if (draft.status === 'paused') return current.status === 'active' ? '/goal pause' : null;
  if (draft.status === 'completed') return '/goal complete';
  return null;
}

/** Whether the dialog may edit the objective: a running goal keeps the one it started with. */
export function canEditObjective(goal: GoalSnapshot | undefined): boolean {
  return !goal || goal.status !== 'active';
}

/** What the dialog's primary button will do, in the dialog's own words. */
export function goalActionLabelKey(
  current: GoalSnapshot | undefined,
  draft: { objective: string; status: GoalStatus }
): string {
  if (!current) return 'chat.goalStart';
  const objective = draft.objective.trim();
  if (objective && objective !== current.objective) return 'chat.goalActionSave';
  if (draft.status === current.status) return 'chat.goalApply';
  if (draft.status === 'active') return 'chat.goalActionResume';
  if (draft.status === 'paused') return 'chat.goalActionPause';
  if (draft.status === 'completed') return 'chat.goalActionFinish';
  return 'chat.goalApply';
}

/** Human label for the button and the dialog header, independent of color. */
export function goalStatusLabelKey(status: GoalStatus): string {
  return `chat.goalStatus.${status}`;
}
