import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const {
  GOAL_LIMITS,
  GOAL_LIMIT_BOUNDS,
  GOAL_LIMIT_PRESETS,
  goalLimitPresetOf,
  goalLimitsFromFields,
  goalStopReason,
  normalizeGoalLimits,
  validateGoalLimits
} = await createJiti(import.meta.url).import('./goal-policy.ts');

const limits = { maxContinuations: 5, maxTokens: 20_000, maxElapsedMs: 60_000 };
const progress = { continuations: 1, tokens: 200, elapsedMs: 1000 };

test('requires whole-number limits inside their bounds', () => {
  assert.equal(validateGoalLimits(limits), true);
  assert.equal(validateGoalLimits(GOAL_LIMITS), true);
  for (const value of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    for (const key of Object.keys(limits)) {
      assert.equal(validateGoalLimits({ ...limits, [key]: value }), false);
    }
  }
  // Each bound is closed: the smallest and largest accepted value still pass.
  for (const key of Object.keys(GOAL_LIMIT_BOUNDS)) {
    const { min, max } = GOAL_LIMIT_BOUNDS[key];
    assert.equal(validateGoalLimits({ ...GOAL_LIMITS, [key]: min }), true, key);
    assert.equal(validateGoalLimits({ ...GOAL_LIMITS, [key]: max }), true, key);
    assert.equal(validateGoalLimits({ ...GOAL_LIMITS, [key]: min - 1 }), false, key);
    assert.equal(validateGoalLimits({ ...GOAL_LIMITS, [key]: max + 1 }), false, key);
  }
});

test('normalizing copies a complete set and refuses a partial or out-of-range one', () => {
  assert.deepEqual(normalizeGoalLimits(limits), limits);
  assert.equal(normalizeGoalLimits({ ...limits, maxTokens: 9_999 }), undefined);
  assert.equal(normalizeGoalLimits({ maxContinuations: 3 }), undefined);
  assert.equal(normalizeGoalLimits(null), undefined);
  assert.equal(normalizeGoalLimits([]), undefined);
  assert.equal(normalizeGoalLimits('5'), undefined);
});

test('presets are valid, distinct, and recognized only when they match exactly', () => {
  assert.deepEqual(
    GOAL_LIMIT_PRESETS.map((preset) => preset.id),
    ['light', 'standard', 'deep']
  );
  for (const preset of GOAL_LIMIT_PRESETS) {
    assert.equal(validateGoalLimits(preset.limits), true, preset.id);
    assert.equal(goalLimitPresetOf(preset.limits), preset.id);
  }
  assert.equal(goalLimitPresetOf({ ...GOAL_LIMITS, maxTokens: 200_001 }), undefined);
});

test('form fields become limits only when all three are usable', () => {
  assert.deepEqual(goalLimitsFromFields({ turns: '5', tokens: '200000', minutes: '30' }), {
    maxContinuations: 5,
    maxTokens: 200_000,
    maxElapsedMs: 30 * 60_000
  });
  assert.equal(goalLimitsFromFields({ turns: '', tokens: '200000', minutes: '30' }), undefined);
  assert.equal(goalLimitsFromFields({ turns: '0', tokens: '200000', minutes: '30' }), undefined);
  assert.equal(goalLimitsFromFields({ turns: '5', tokens: '200000', minutes: '0' }), undefined);
  assert.equal(goalLimitsFromFields({ turns: '5', tokens: '200000', minutes: '481' }), undefined);
});

test('stops at each limit and respects aborts and errors', () => {
  assert.equal(goalStopReason(limits, progress, 'completed'), undefined);
  assert.equal(
    goalStopReason(limits, { ...progress, continuations: 5 }, 'completed'),
    'continuations'
  );
  assert.equal(goalStopReason(limits, { ...progress, tokens: 20_000 }, 'completed'), 'tokens');
  assert.equal(goalStopReason(limits, { ...progress, elapsedMs: 60_000 }, 'completed'), 'time');
  assert.equal(goalStopReason(limits, progress, 'aborted'), 'aborted');
  assert.equal(goalStopReason(limits, progress, 'error'), 'error');
});

test('invalid limits or progress fail closed', () => {
  assert.equal(
    goalStopReason({ ...limits, maxTokens: Infinity }, progress, 'completed'),
    'invalid'
  );
  assert.equal(goalStopReason({ ...limits, maxTokens: 9_999 }, progress, 'completed'), 'invalid');
  for (const key of Object.keys(progress)) {
    for (const value of [-1, NaN, Infinity, 0.5]) {
      assert.equal(goalStopReason(limits, { ...progress, [key]: value }, 'completed'), 'invalid');
    }
  }
});
