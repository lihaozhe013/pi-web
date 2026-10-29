/** Pure decisions for an autonomous goal. Runtime code owns persistence and cancellation. */
export interface GoalLimits {
  maxContinuations: number;
  maxTokens: number;
  maxElapsedMs: number;
}

/** The limits a goal runs under when nothing else was chosen. */
export const GOAL_LIMITS: GoalLimits = {
  maxContinuations: 5,
  maxTokens: 200_000,
  maxElapsedMs: 30 * 60_000
};

/**
 * The accepted range of each limit. A value outside its range is refused rather
 * than clamped, so a typo cannot quietly become a long unattended run.
 */
export const GOAL_LIMIT_BOUNDS: Record<keyof GoalLimits, { min: number; max: number }> = {
  maxContinuations: { min: 1, max: 50 },
  maxTokens: { min: 10_000, max: 5_000_000 },
  maxElapsedMs: { min: 60_000, max: 8 * 60 * 60_000 }
};

export type GoalLimitPresetId = 'light' | 'standard' | 'deep';

/** The depths the Goal dialog offers; a person can still type their own numbers. */
export const GOAL_LIMIT_PRESETS: readonly { id: GoalLimitPresetId; limits: GoalLimits }[] = [
  {
    id: 'light',
    limits: { maxContinuations: 2, maxTokens: 60_000, maxElapsedMs: 10 * 60_000 }
  },
  { id: 'standard', limits: GOAL_LIMITS },
  {
    id: 'deep',
    limits: { maxContinuations: 10, maxTokens: 500_000, maxElapsedMs: 60 * 60_000 }
  }
];

function withinBounds(key: keyof GoalLimits, value: unknown): value is number {
  const bounds = GOAL_LIMIT_BOUNDS[key];
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= bounds.min &&
    value <= bounds.max
  );
}

/** One limit inside its range, or undefined when it is missing or out of range. */
export function goalLimitValue(key: keyof GoalLimits, value: unknown): number | undefined {
  return withinBounds(key, value) ? value : undefined;
}

/**
 * A complete, in-range set of limits, copied; undefined when any value is
 * missing, not a whole number, or outside its range.
 */
export function normalizeGoalLimits(value: unknown): GoalLimits | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const limits = value as Partial<Record<keyof GoalLimits, unknown>>;
  if (!withinBounds('maxContinuations', limits.maxContinuations)) return undefined;
  if (!withinBounds('maxTokens', limits.maxTokens)) return undefined;
  if (!withinBounds('maxElapsedMs', limits.maxElapsedMs)) return undefined;
  return {
    maxContinuations: limits.maxContinuations,
    maxTokens: limits.maxTokens,
    maxElapsedMs: limits.maxElapsedMs
  };
}

/** The preset matching exactly these limits, if any; otherwise the person set their own. */
export function goalLimitPresetOf(limits: GoalLimits): GoalLimitPresetId | undefined {
  return GOAL_LIMIT_PRESETS.find((preset) => sameGoalLimits(preset.limits, limits))?.id;
}

export function sameGoalLimits(a: GoalLimits, b: GoalLimits): boolean {
  return (
    a.maxContinuations === b.maxContinuations &&
    a.maxTokens === b.maxTokens &&
    a.maxElapsedMs === b.maxElapsedMs
  );
}

/** Minutes are what people type; the policy stores milliseconds. */
export function goalLimitsFromFields(fields: {
  turns: string;
  tokens: string;
  minutes: string;
}): GoalLimits | undefined {
  const turns = Number(fields.turns.trim());
  const tokens = Number(fields.tokens.trim());
  const minutes = Number(fields.minutes.trim());
  if (!fields.turns.trim() || !fields.tokens.trim() || !fields.minutes.trim()) return undefined;
  return normalizeGoalLimits({
    maxContinuations: turns,
    maxTokens: tokens,
    maxElapsedMs: minutes * 60_000
  });
}

export interface GoalProgress {
  continuations: number;
  tokens: number;
  elapsedMs: number;
}

export type GoalStopReason = 'continuations' | 'tokens' | 'time' | 'aborted' | 'error' | 'invalid';

/** Limits are checked between runs; a request or tool already in flight may exceed them. */
export function goalStopReason(
  limits: GoalLimits,
  progress: GoalProgress,
  outcome: 'completed' | 'aborted' | 'error'
): GoalStopReason | undefined {
  if (outcome === 'aborted') return 'aborted';
  if (outcome === 'error') return 'error';
  if (
    !validateGoalLimits(limits) ||
    ![progress.continuations, progress.tokens, progress.elapsedMs].every(
      (value) => Number.isSafeInteger(value) && value >= 0
    )
  )
    return 'invalid';
  if (progress.continuations >= limits.maxContinuations) return 'continuations';
  if (progress.tokens >= limits.maxTokens) return 'tokens';
  if (progress.elapsedMs >= limits.maxElapsedMs) return 'time';
  return undefined;
}

/** Reject invalid or unbounded limits rather than accidentally creating an endless loop. */
export function validateGoalLimits(limits: GoalLimits): boolean {
  return normalizeGoalLimits(limits) !== undefined;
}
