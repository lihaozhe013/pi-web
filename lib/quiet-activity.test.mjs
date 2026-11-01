import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { mainTranscriptBlocks } = await jiti.import('./quiet-activity.ts');

test('a question lives in the Runs panel, not the transcript', () => {
  const call = {
    type: 'toolCall',
    toolName: 'ask_user',
    toolCallId: 'q1',
    args: { question: 'Which layout?' }
  };
  assert.deepEqual(mainTranscriptBlocks([call], new Map(), new Set(['q1'])), []);
  for (const isError of [false, true]) {
    const result = { role: 'toolResult', toolCallId: 'q1', isError, content: [] };
    assert.deepEqual(mainTranscriptBlocks([call], new Map([['q1', result]])), []);
  }
  assert.equal(call.args.question, 'Which layout?', 'filtering must not mutate history');
});

test('writes, edits, and patches keep their running and finished cards', () => {
  for (const [index, toolName] of [
    'write',
    'edit_like',
    'mcp__fs__write',
    'str_replace_editor',
    'apply_patch',
    'mcp__fs__apply_patch'
  ].entries()) {
    const call = { type: 'toolCall', toolName, toolCallId: `we${index}`, args: {} };
    assert.deepEqual(
      mainTranscriptBlocks([call], new Map(), new Set([call.toolCallId])),
      [call],
      `${toolName} running`
    );
    const result = { role: 'toolResult', toolCallId: call.toolCallId, isError: false, content: [] };
    assert.deepEqual(
      mainTranscriptBlocks([call], new Map([[call.toolCallId, result]])),
      [call],
      `${toolName} finished`
    );
  }
});

test('a codemode script lives in the Runs panel, not the transcript', () => {
  const call = { type: 'toolCall', toolName: 'codemode', toolCallId: 'cm1', input: {} };
  assert.deepEqual(
    mainTranscriptBlocks([call], new Map(), new Set(['cm1'])),
    [],
    'a running script has no transcript card'
  );
  for (const isError of [false, true]) {
    const result = { role: 'toolResult', toolCallId: 'cm1', isError, content: [] };
    assert.deepEqual(
      mainTranscriptBlocks([call], new Map([['cm1', result]])),
      [],
      `a finished script isError=${isError} still belongs to the panel`
    );
  }
});

test('a shell command lives in the Runs panel, not the transcript', () => {
  for (const toolName of ['bash', 'powershell', 'shell']) {
    const call = { type: 'toolCall', toolName, toolCallId: `sh-${toolName}`, input: {} };
    for (const [results, running] of [
      [new Map(), new Set([call.toolCallId])],
      [
        new Map([
          [
            call.toolCallId,
            { role: 'toolResult', toolCallId: call.toolCallId, isError: false, content: [] }
          ]
        ]),
        new Set()
      ],
      [
        new Map([
          [
            call.toolCallId,
            { role: 'toolResult', toolCallId: call.toolCallId, isError: true, content: [] }
          ]
        ]),
        new Set()
      ]
    ]) {
      assert.deepEqual(mainTranscriptBlocks([call], results, running), [], toolName);
    }
  }
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

test('every other tool call belongs to the Runs panel', () => {
  for (const toolName of [
    'mcp__github__list_issues',
    'find_user',
    'codegrep',
    'glob',
    'web_fetch'
  ]) {
    const call = { type: 'toolCall', toolName, toolCallId: `x-${toolName}`, args: {} };
    assert.deepEqual(
      mainTranscriptBlocks([call], new Map(), new Set([call.toolCallId])),
      [],
      toolName
    );
  }
});

test('the conversation-only display hides the kept cards too', () => {
  const blocks = [
    { type: 'text', text: 'done' },
    { type: 'toolCall', toolName: 'write', toolCallId: 'w1', input: {} },
    { type: 'toolCall', toolName: 'edit', toolCallId: 'e1', input: {} },
    { type: 'toolCall', toolName: 'apply_patch', toolCallId: 'p1', input: {} }
  ];
  const results = new Map(
    ['w1', 'e1', 'p1'].map((id) => [id, { role: 'toolResult', toolCallId: id, content: [] }])
  );
  assert.deepEqual(
    mainTranscriptBlocks(blocks, results, new Set()).map((block) => block.type),
    ['text', 'toolCall', 'toolCall', 'toolCall'],
    'the default keeps the cards'
  );
  assert.deepEqual(
    mainTranscriptBlocks(blocks, results, new Set(), 'conversation').map((block) => block.type),
    ['text'],
    'conversation-only leaves the reply text'
  );
});
