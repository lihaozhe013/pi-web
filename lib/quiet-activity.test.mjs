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

test('a search or listing leaves no card, running, successful, or failed', () => {
  const names = ['grep', 'find', 'ls', 'mcp__fs__grep', 'search.find'];
  for (const [index, toolName] of names.entries()) {
    const call = { type: 'toolCall', toolName, toolCallId: `t${index}`, args: {} };
    assert.deepEqual(
      mainTranscriptBlocks([call], new Map(), new Set([call.toolCallId])),
      [],
      toolName
    );
    for (const isError of [false, true]) {
      const result = { role: 'toolResult', toolCallId: call.toolCallId, isError, content: [] };
      assert.deepEqual(
        mainTranscriptBlocks([call], new Map([[call.toolCallId, result]])),
        [],
        `${toolName} isError=${isError}`
      );
    }
  }
});

test('a longer name that only contains a search word keeps its card', () => {
  for (const toolName of ['mcp__github__list_issues', 'find_user', 'codegrep', 'glob']) {
    const call = { type: 'toolCall', toolName, toolCallId: `x-${toolName}`, args: {} };
    assert.deepEqual(
      mainTranscriptBlocks([call], new Map(), new Set([call.toolCallId])),
      [call],
      toolName
    );
  }
});
