import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const { goalStopReason, validateGoalLimits } = await createJiti(import.meta.url).import(
  './goal-policy.ts'
);
const limits = { maxContinuations: 5, maxTokens: 1000, maxElapsedMs: 60000 };
const progress = { continuations: 1, tokens: 200, elapsedMs: 1000 };

test('requires positive finite integer limits', () => {
  assert.equal(validateGoalLimits(limits), true);
  for (const value of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    for (const key of Object.keys(limits)) {
      assert.equal(validateGoalLimits({ ...limits, [key]: value }), false);
    }
  }
});

test('stops at each limit and respects aborts and errors', () => {
  assert.equal(goalStopReason(limits, progress, 'completed'), undefined);
  assert.equal(
    goalStopReason(limits, { ...progress, continuations: 5 }, 'completed'),
    'continuations'
  );
  assert.equal(goalStopReason(limits, { ...progress, tokens: 1000 }, 'completed'), 'tokens');
  assert.equal(goalStopReason(limits, { ...progress, elapsedMs: 60000 }, 'completed'), 'time');
  assert.equal(goalStopReason(limits, progress, 'aborted'), 'aborted');
  assert.equal(goalStopReason(limits, progress, 'error'), 'error');
});

test('invalid limits or progress fail closed', () => {
  assert.equal(
    goalStopReason({ ...limits, maxTokens: Infinity }, progress, 'completed'),
    'invalid'
  );
  for (const key of Object.keys(progress)) {
    for (const value of [-1, NaN, Infinity, 0.5]) {
      assert.equal(goalStopReason(limits, { ...progress, [key]: value }, 'completed'), 'invalid');
    }
  }
});
