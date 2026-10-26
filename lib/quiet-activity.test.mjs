import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { mainTranscriptBlocks } = await jiti.import('./quiet-activity.ts');

test('a pending question uses its panel without a duplicate raw tool card', () => {
  const call = {
    type: 'toolCall',
    toolName: 'ask_user',
    toolCallId: 'q1',
    args: { question: 'Which layout?' }
  };
  assert.deepEqual(mainTranscriptBlocks([call], new Map(), new Set(['q1'])), []);
  for (const isError of [false, true]) {
    const result = { role: 'toolResult', toolCallId: 'q1', isError, content: [] };
    assert.deepEqual(mainTranscriptBlocks([call], new Map([['q1', result]])), [call]);
  }
  assert.equal(call.args.question, 'Which layout?', 'filtering must not mutate history');
});

test('other executing tools retain their running card', () => {
  const call = { type: 'toolCall', toolName: 'write', toolCallId: 'w1', args: {} };
  assert.deepEqual(mainTranscriptBlocks([call], new Map(), new Set(['w1'])), [call]);
});
