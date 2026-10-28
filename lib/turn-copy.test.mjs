import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildTurnCopy } = await jiti.import('./turn-copy.ts');

const user = { role: 'user', content: 'Refactor the parser.' };
const finalAnswer = {
  role: 'assistant',
  provider: 'test',
  model: 'test-model',
  content: [{ type: 'text', text: 'Refactored the parser.' }]
};

function results(entries) {
  return new Map(entries.map((result) => [result.toolCallId, result]));
}

function toolResult(toolCallId, { text = '', isError = false, details } = {}) {
  return {
    role: 'toolResult',
    toolCallId,
    content: text ? [{ type: 'text', text }] : [],
    isError,
    ...(details === undefined ? {} : { details })
  };
}

// A turn that edited a file, ran a successful command, and read one file.
const editCall = {
  type: 'toolCall',
  toolCallId: 'e1',
  toolName: 'edit',
  input: { path: 'src/parser.ts', oldText: 'a', newText: 'b' }
};
const shellCall = {
  type: 'toolCall',
  toolCallId: 's1',
  toolName: 'bash',
  input: { command: 'bun test src/parser.test.ts' }
};
const readCall = {
  type: 'toolCall',
  toolCallId: 'r1',
  toolName: 'read',
  input: { path: 'src/parser.ts' }
};
const workedTurn = [
  user,
  {
    role: 'assistant',
    provider: 'test',
    model: 'test-model',
    content: [
      { type: 'thinking', thinking: 'The parser needs two edits.' },
      readCall,
      editCall,
      { type: 'text', text: 'The parser now reads both forms.' }
    ]
  },
  toolResult('r1', { text: 'file body' }),
  toolResult('e1', { text: 'Edited src/parser.ts' }),
  {
    role: 'assistant',
    provider: 'test',
    model: 'test-model',
    content: [shellCall, { type: 'text', text: 'Tests pass.' }]
  },
  toolResult('s1', { text: '2 passed' }),
  finalAnswer
];
const workedResults = results([
  toolResult('r1', { text: 'file body' }),
  toolResult('e1', { text: 'Edited src/parser.ts' }),
  toolResult('s1', { text: '2 passed' })
]);

test('the conversation choice keeps the prompt and the replies and nothing else', () => {
  const text = buildTurnCopy({ mode: 'answers', messages: workedTurn, toolResults: workedResults });
  assert.match(text, /^## User\n\nRefactor the parser\./);
  assert.match(text, /## Assistant/);
  assert.match(text, /The parser now reads both forms\./);
  assert.match(text, /Tests pass\./);
  assert.match(text, /Refactored the parser\./);
  assert.doesNotMatch(text, /toolCall|bun test|Edited src\/parser|The parser needs two edits/);
});

test('thinking and exploration calls stay out of every choice', () => {
  for (const mode of ['answers', 'transcript', 'execution']) {
    const text = buildTurnCopy({ mode, messages: workedTurn, toolResults: workedResults });
    assert.doesNotMatch(text, /The parser needs two edits/, mode);
    assert.doesNotMatch(text, /### read/, mode);
    assert.doesNotMatch(text, /file body/, mode);
  }
});

test('the kept record carries a retained edit with its arguments and result', () => {
  const text = buildTurnCopy({
    mode: 'transcript',
    messages: workedTurn,
    toolResults: workedResults
  });
  assert.match(text, /### edit/);
  assert.match(text, /"path": "src\/parser\.ts"/);
  assert.match(text, /\*\*Result\*\*/);
  assert.match(text, /Edited src\/parser\.ts/);
});

test('a successful command folds out of the kept record but stays in the execution log', () => {
  const kept = buildTurnCopy({
    mode: 'transcript',
    messages: workedTurn,
    toolResults: workedResults
  });
  assert.doesNotMatch(kept, /### bash/);

  const log = buildTurnCopy({
    mode: 'execution',
    messages: workedTurn,
    toolResults: workedResults
  });
  assert.match(log, /### bash/);
  assert.match(log, /"command": "bun test src\/parser\.test\.ts"/);
  assert.match(log, /2 passed/);
});

test('a failed command keeps its call and error in both record choices', () => {
  const failed = [
    user,
    {
      role: 'assistant',
      provider: 'test',
      model: 'test-model',
      content: [
        { type: 'toolCall', toolCallId: 's2', toolName: 'bash', input: { command: 'bun run lint' } }
      ]
    },
    toolResult('s2', { text: 'error: unknown flag', isError: true }),
    finalAnswer
  ];
  const failedResults = results([toolResult('s2', { text: 'error: unknown flag', isError: true })]);
  for (const mode of ['transcript', 'execution']) {
    const text = buildTurnCopy({ mode, messages: failed, toolResults: failedResults });
    assert.match(text, /### bash/, mode);
    assert.match(text, /\*\*Error\*\*/, mode);
    assert.match(text, /unknown flag/, mode);
  }
});

test('an execution log keeps a call’s structured details and a record does not', () => {
  const call = {
    type: 'toolCall',
    toolCallId: 'p1',
    toolName: 'apply_patch',
    input: { patch: '*** Begin Patch' }
  };
  const turn = [
    user,
    { role: 'assistant', provider: 'test', model: 'test-model', content: [call] },
    toolResult('p1', { text: 'Applied', details: { files: ['a.ts'] } }),
    finalAnswer
  ];
  const log = buildTurnCopy({
    mode: 'execution',
    messages: turn,
    toolResults: results([toolResult('p1', { text: 'Applied', details: { files: ['a.ts'] } })])
  });
  assert.match(log, /\*\*Details\*\*/);
  assert.match(log, /"files": \[\n\s+"a\.ts"/);

  const kept = buildTurnCopy({
    mode: 'transcript',
    messages: turn,
    toolResults: results([toolResult('p1', { text: 'Applied', details: { files: ['a.ts'] } })])
  });
  assert.doesNotMatch(kept, /\*\*Details\*\*/);
});

test('a command the user ran keeps its output in the record choices only', () => {
  const turn = [user, { role: 'bashExecution', command: 'ls', output: 'a.ts\nb.ts', exitCode: 0 }];
  assert.equal(
    buildTurnCopy({ mode: 'answers', messages: turn }),
    '## User\n\nRefactor the parser.'
  );
  const record = buildTurnCopy({ mode: 'transcript', messages: turn });
  assert.match(record, /### Shell \(run by the user\)/);
  assert.match(record, /"command": "ls"/);
  assert.match(record, /b\.ts/);
});

test('output that contains a code fence cannot close its own block', () => {
  const turn = [
    user,
    {
      role: 'assistant',
      provider: 'test',
      model: 'test-model',
      content: [{ type: 'toolCall', toolCallId: 's3', toolName: 'bash', input: { command: 'cat' } }]
    },
    toolResult('s3', { text: '```js\nconsole.log(1)\n```' }),
    finalAnswer
  ];
  const text = buildTurnCopy({
    mode: 'execution',
    messages: turn,
    toolResults: results([toolResult('s3', { text: '```js\nconsole.log(1)\n```' })])
  });
  assert.match(text, /````text\n```js\nconsole\.log\(1\)\n```\n````/);
});

test('a response that failed says so in its copy', () => {
  const turn = [
    user,
    {
      role: 'assistant',
      provider: 'test',
      model: 'test-model',
      stopReason: 'error',
      errorMessage: 'provider overloaded',
      content: []
    }
  ];
  assert.match(
    buildTurnCopy({ mode: 'answers', messages: turn }),
    /Response failed: provider overloaded/
  );
});
