import { existsSync, readFileSync } from 'node:fs';
import {
  getGlobalSettingsPath,
  readGlobalSettings,
  updateGlobalSettings
} from './global-settings-file';
import { GOAL_LIMITS, goalLimitValue, normalizeGoalLimits, type GoalLimits } from './goal-policy';

/**
 * The global `settings.json` key holding the default depth of a new goal. It
 * lives beside pi's own keys, so it is edited where the rest of the person's
 * settings are, and a goal can still choose its own limits in the dialog.
 */
export const GOAL_SETTINGS_KEY = 'piWebGoal';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The stored defaults. Each field falls back on its own, so one hand-edited
 * value that is out of range cannot take the other two with it, and nothing
 * here can produce an unbounded goal.
 */
export function goalLimitsFromSettings(settings: Record<string, unknown>): GoalLimits {
  const stored = settings[GOAL_SETTINGS_KEY];
  if (!isRecord(stored)) return GOAL_LIMITS;
  return {
    maxContinuations:
      goalLimitValue('maxContinuations', stored.maxContinuations) ?? GOAL_LIMITS.maxContinuations,
    maxTokens: goalLimitValue('maxTokens', stored.maxTokens) ?? GOAL_LIMITS.maxTokens,
    maxElapsedMs: goalLimitValue('maxElapsedMs', stored.maxElapsedMs) ?? GOAL_LIMITS.maxElapsedMs
  };
}

/**
 * The defaults as they are on disk right now. The extension reads this when a
 * goal starts, so a change in Settings applies to the next start or resume
 * without restarting the session; a missing or unreadable file means defaults.
 */
export function readGoalLimitsSync(settingsPath = getGlobalSettingsPath()): GoalLimits {
  try {
    if (!existsSync(settingsPath)) return GOAL_LIMITS;
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return isRecord(parsed) ? goalLimitsFromSettings(parsed) : GOAL_LIMITS;
  } catch {
    return GOAL_LIMITS;
  }
}

/** The same defaults read under the file lock, for the API and the settings form. */
export async function readGoalLimits(settingsPath = getGlobalSettingsPath()): Promise<GoalLimits> {
  return readGlobalSettings(settingsPath, goalLimitsFromSettings);
}

/** Write all three defaults; anything out of range is refused, not clamped. */
export async function writeGoalLimits(
  limits: unknown,
  settingsPath = getGlobalSettingsPath()
): Promise<GoalLimits> {
  const normalized = normalizeGoalLimits(limits);
  if (!normalized) throw new Error('Goal limits are out of range');
  await updateGlobalSettings(settingsPath, (settings) => {
    settings[GOAL_SETTINGS_KEY] = { ...normalized };
  });
  return normalized;
}
