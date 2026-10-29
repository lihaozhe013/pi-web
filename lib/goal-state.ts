import {
  GOAL_LIMITS,
  goalLimitValue,
  normalizeGoalLimits,
  sameGoalLimits,
  type GoalLimits
} from './goal-policy';
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
  /** The depth this goal runs at; absent on goals started before depth was configurable. */
  limits?: GoalLimits;
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
  const limits = normalizeGoalLimits(goal.limits);
  return {
    version: 1,
    objective: goal.objective,
    status: goal.status,
    continuations: Math.max(0, Math.floor(goal.continuations as number)),
    startedAt: goal.startedAt as number,
    baselineTokens: Math.max(0, Math.floor(goal.baselineTokens as number)),
    ...(typeof goal.reason === 'string' && goal.reason ? { reason: goal.reason } : {}),
    ...(limits ? { limits } : {})
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

/** The limits this goal actually runs at: its own, or the defaults it was started under. */
export function effectiveGoalLimits(
  goal: GoalSnapshot | undefined,
  defaults: GoalLimits = GOAL_LIMITS
): GoalLimits {
  return goal?.limits ?? defaults;
}

export type GoalAction = 'start' | 'resume' | 'pause' | 'complete' | 'clear' | 'limits' | 'status';

export interface ParsedGoalCommand {
  action: GoalAction;
  /** Everything after the flags, trimmed. */
  objective: string;
  /** Only the depth flags that were written; the rest comes from defaults or the goal. */
  limits?: Partial<GoalLimits>;
  error?: 'missing-objective' | 'invalid-limits';
}

const FLAG_KEYS: Record<string, keyof GoalLimits> = {
  '--turns': 'maxContinuations',
  '--tokens': 'maxTokens',
  '--minutes': 'maxElapsedMs'
};

const ACTIONS: readonly GoalAction[] = [
  'start',
  'resume',
  'pause',
  'complete',
  'clear',
  'limits',
  'status'
];

/**
 * `/goal <action> [--turns N] [--tokens N] [--minutes N] <objective>`.
 * Flags must come before the objective, so an objective may contain anything,
 * including dashes. Flags are optional: without them a start or resume uses the
 * stored defaults or the goal's own depth.
 */
export function parseGoalCommand(text: string): ParsedGoalCommand {
  const trimmed = text.trim();
  const head = trimmed.split(/\s+/, 1)[0];
  if (!(ACTIONS as readonly string[]).includes(head))
    return { action: 'status', objective: trimmed };
  const action = head as GoalAction;
  let rest = trimmed.slice(head.length);
  const limits: Partial<GoalLimits> = {};
  for (;;) {
    const flag = /^\s*(--turns|--tokens|--minutes)(?:=|\s+)(\S+)/.exec(rest);
    if (!flag) break;
    const key = FLAG_KEYS[flag[1]];
    const typed = Number(flag[2]);
    const value = key === 'maxElapsedMs' ? typed * 60_000 : typed;
    if (!Number.isFinite(typed) || goalLimitValue(key, value) === undefined)
      return { action, objective: '', error: 'invalid-limits' };
    limits[key] = value;
    rest = rest.slice(flag[0].length);
  }
  const objective = rest.trim();
  if (action === 'start' && !objective) return { action, objective, error: 'missing-objective' };
  return {
    action,
    objective,
    ...(Object.keys(limits).length > 0 ? { limits } : {})
  };
}

/** The flags a dialog writes, from the full depth it resolved. */
export function formatGoalLimitsFlags(limits: GoalLimits): string {
  return [
    `--turns ${limits.maxContinuations}`,
    `--tokens ${limits.maxTokens}`,
    `--minutes ${limits.maxElapsedMs / 60_000}`
  ].join(' ');
}

export interface GoalDraft {
  objective: string;
  status: GoalStatus;
  limits?: GoalLimits;
}

/**
 * The command the composer's Goal dialog sends, or null when nothing needs to
 * change. A start or resume always carries the depth the dialog shows, so the
 * goal runs at exactly what was on screen; a depth-only edit uses `/goal limits`
 * and never restarts the run.
 */
export function goalCommand(
  current: GoalSnapshot | undefined,
  draft: GoalDraft,
  defaults: GoalLimits = GOAL_LIMITS
): string | null {
  const objective = draft.objective.trim();
  if (objective.length > 4000) return null;
  const flags = draft.limits ? formatGoalLimitsFlags(draft.limits) : '';
  const withFlags = (command: string, text?: string) =>
    [command, flags, text].filter(Boolean).join(' ');

  if (!current) return objective ? withFlags('/goal start', objective) : null;
  if (!objective) return null;
  // A running goal keeps the objective it started with; changing it needs a pause first.
  if (objective !== current.objective)
    return current.status === 'active' ? null : withFlags('/goal start', objective);
  if (draft.status !== current.status) {
    if (draft.status === 'active') return withFlags('/goal resume');
    if (draft.status === 'paused') return current.status === 'active' ? '/goal pause' : null;
    if (draft.status === 'completed') return '/goal complete';
    return null;
  }
  if (draft.limits && !sameGoalLimits(draft.limits, effectiveGoalLimits(current, defaults)))
    return withFlags('/goal limits');
  return null;
}

/** Whether the dialog may edit the objective and depth: a running goal keeps both. */
export function canEditObjective(goal: GoalSnapshot | undefined): boolean {
  return !goal || goal.status !== 'active';
}

/** What the dialog's primary button will do, in the dialog's own words. */
export function goalActionLabelKey(
  current: GoalSnapshot | undefined,
  draft: GoalDraft,
  defaults: GoalLimits = GOAL_LIMITS
): string {
  if (!current) return 'chat.goalStart';
  const objective = draft.objective.trim();
  if (objective && objective !== current.objective) return 'chat.goalActionSave';
  if (draft.status !== current.status) {
    if (draft.status === 'active') return 'chat.goalActionResume';
    if (draft.status === 'paused') return 'chat.goalActionPause';
    if (draft.status === 'completed') return 'chat.goalActionFinish';
    return 'chat.goalApply';
  }
  if (draft.limits && !sameGoalLimits(draft.limits, effectiveGoalLimits(current, defaults)))
    return 'chat.goalActionSaveDepth';
  return 'chat.goalApply';
}

/** Human label for the button and the dialog header, independent of color. */
export function goalStatusLabelKey(status: GoalStatus): string {
  return `chat.goalStatus.${status}`;
}
