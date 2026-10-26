import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  estimateTokens,
  estimateUpdatedTokens,
  getTokenEstimateText,
  createBlockEstimator
} = await jiti.import('./token-estimate.ts');

test('CJK characters count about one token each, others about a quarter', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('中文'), 2);
  assert.equal(estimateTokens('ab中'), 1.5);
});

test('the incremental estimate matches a fresh estimate of the whole text', () => {
  const previous = { text: 'hello wor', tokens: estimateTokens('hello wor') };
  assert.equal(estimateUpdatedTokens(previous, 'hello world'), estimateTokens('hello world'));
  // Replaced text is not a prefix: re-estimate from scratch, not from the cache.
  const replaced = estimateUpdatedTokens({ text: 'hello wor', tokens: 99 }, 'goodbye');
  assert.equal(replaced, estimateTokens('goodbye'));
});

test('completing a surrogate pair corrects the earlier over-count', () => {
  const half = '😀'.slice(0, 1); // a lone high surrogate, counted as one plain char
  const previous = { text: half, tokens: estimateTokens(half) };
  assert.equal(estimateUpdatedTokens(previous, '😀'), estimateTokens('😀'));
});

test('the text that stands for a block follows its type', () => {
  assert.equal(getTokenEstimateText({ type: 'text', text: 'a' }), 'a');
  assert.equal(getTokenEstimateText({ type: 'thinking', thinking: 'h' }), 'h');
  const call = {
    type: 'toolCall',
    toolCallId: 'c',
    toolName: 'read',
    input: { path: 'x' },
    rawInput: '{"path"'
  };
  assert.equal(getTokenEstimateText(call), '{"path"');
  assert.equal(getTokenEstimateText({ ...call, rawInput: undefined }), JSON.stringify({ path: 'x' }));
  assert.equal(getTokenEstimateText({ type: 'image', source: { type: 'url', url: 'x' } }), null);
});

test('the estimator keeps one slot and re-estimates when the key changes', () => {
  const estimator = createBlockEstimator();
  assert.equal(estimator.estimate(null, 0), 0);
  assert.equal(estimator.estimate('abcd', 0), 1);
  // Same key, grown text: incremental.
  assert.equal(estimator.estimate('abcdef', 0), 1.5);
  // Another key: no prefix inheritance across blocks.
  assert.equal(estimator.estimate('ab', 1), 0.5);
  // Back to the first key with a fresh, shorter text: full re-estimate.
  assert.equal(estimator.estimate('ab', 0), 0.5);
  estimator.reset();
  assert.equal(estimator.estimate('ab', 0), 0.5);
});
