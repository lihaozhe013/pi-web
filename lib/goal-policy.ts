/** Pure decisions for an autonomous goal. Runtime code owns persistence and cancellation. */
export interface GoalLimits {
  maxContinuations: number;
  maxTokens: number;
  maxElapsedMs: number;
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
  return [limits.maxContinuations, limits.maxTokens, limits.maxElapsedMs].every(
    (value) => Number.isSafeInteger(value) && value > 0
  );
}
