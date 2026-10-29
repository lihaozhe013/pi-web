import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
  buildExecutionHistory,
  executionOutputTail,
  formatExecutionDuration,
  retainExecutionHistory
} = await jiti.import('./execution-history.ts');

const assistant = (...content) => ({
  role: 'assistant',
  provider: 'anthropic',
  model: 'claude-test',
  content,
  timestamp: 1_000
});

const toolCall = (toolCallId, toolName, input) => ({
  type: 'toolCall',
  toolCallId,
  toolName,
  input
});

const result = (toolCallId, text, options = {}) => ({
  role: 'toolResult',
  toolCallId,
  content: text ? [{ type: 'text', text }] : [],
  ...options
});

test('collects shell and codemode runs with their output and codemode calls', () => {
  const bash = toolCall('b1', 'bash', { command: 'bun test' });
  const codemode = toolCall('c1', 'codemode', {
    code: '// @options: {"timeoutMs": 5000}\nconst files = await tools.ls({ path: "." });'
  });
  const messages = [
    assistant(toolCall('read-1', 'read', { path: 'a' }), bash, { type: 'text', text: 'working' }),
    assistant(codemode)
  ];
  const results = new Map([
    [
      'b1',
      result('b1', '2 tests passed', {
        durationMs: 1_500,
        timestamp: 2_500
      })
    ],
    [
      'c1',
      {
        ...result('c1', '', {
          durationMs: 120,
          details: {
            calls: [{ id: 'c1/1', name: 'ls', args: '{"path":"."}', status: 'ok', durationMs: 4 }]
          }
        }),
        content: [
          { type: 'text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' },
          { type: 'text', text: 'files: 3' }
        ]
      }
    ]
  ]);

  const entries = buildExecutionHistory(messages, results, new Set());

  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map(({ id, kind, toolName, status }) => ({ id, kind, toolName, status })),
    [
      { id: 'b1', kind: 'shell', toolName: 'bash', status: 'success' },
      { id: 'c1', kind: 'codemode', toolName: 'codemode', status: 'success' }
    ]
  );
  assert.equal(entries[0].command, 'bun test');
  assert.equal(entries[0].preview, 'bun test');
  assert.equal(entries[0].output, '2 tests passed');
  assert.equal(entries[0].durationMs, 1_500);
  assert.equal(
    entries[1].script,
    '// @options: {"timeoutMs": 5000}\nconst files = await tools.ls({ path: "." });'
  );
  assert.equal(entries[1].preview, 'const files = await tools.ls({ path: "." });');
  assert.equal(entries[1].output, 'files: 3');
  assert.deepEqual(
    entries[1].calls.map((call) => call.name),
    ['ls']
  );
});

test('a running run carries its partial output and stays running', () => {
  const bash = toolCall('b1', 'bash', { command: 'sleep 5' });
  const messages = [assistant(bash)];
  const partial = result('b1', 'waiting');
  const entries = buildExecutionHistory(messages, new Map([['b1', partial]]), new Set(['b1']));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'running');
  assert.equal(entries[0].output, 'waiting');
});

test('a run that never executed leaves no entry', () => {
  const bash = toolCall('b1', 'bash', { command: 'echo never' });
  assert.deepEqual(buildExecutionHistory([assistant(bash)], new Map(), new Set()), []);
});

test('failed and cancelled runs keep their error status', () => {
  const bash = toolCall('b1', 'bash', { command: 'exit 2' });
  const codemode = toolCall('c1', 'codemode', { code: 'throw new Error("x")' });
  const messages = [assistant(bash), assistant(codemode)];
  const results = new Map([
    ['b1', result('b1', 'boom', { isError: true })],
    ['c1', result('c1', 'stopped', { details: { cancelled: true } })]
  ]);

  const entries = buildExecutionHistory(messages, results, new Set());
  assert.deepEqual(
    entries.map((entry) => entry.status),
    ['error', 'cancelled']
  );
});

test('user-run commands are history too, including a pending one', () => {
  const messages = [
    {
      role: 'bashExecution',
      command: 'git status',
      output: 'clean',
      exitCode: 0,
      timestamp: 40
    },
    {
      role: 'bashExecution',
      command: 'ls missing',
      output: 'No such file',
      exitCode: 2,
      timestamp: 50
    }
  ];

  const entries = buildExecutionHistory(messages, new Map(), new Set(), {
    pendingBash: { command: 'pwd' }
  });

  assert.deepEqual(
    entries.map(({ command, status, userInitiated }) => ({ command, status, userInitiated })),
    [
      { command: 'git status', status: 'success', userInitiated: true },
      { command: 'ls missing', status: 'error', userInitiated: true },
      { command: 'pwd', status: 'running', userInitiated: true }
    ]
  );
});

test('a run that vanished for a moment keeps its place until its result lands', () => {
  const base = {
    kind: 'shell',
    toolName: 'bash',
    command: 'bun test',
    preview: 'bun test'
  };
  const running = { ...base, id: 'b1', status: 'running', output: 'partial' };
  const complete = { ...running, status: 'success', output: 'done' };
  const other = { ...base, id: 'b2', status: 'running', output: '' };

  // The gap render: the call is no longer live and has no stored result yet.
  assert.deepEqual(
    retainExecutionHistory([running, other], [other]).map((entry) => entry.id),
    ['b1', 'b2']
  );
  // The result arrives under the same id and replaces the retained run.
  assert.deepEqual(retainExecutionHistory([running, other], [complete, other]), [complete, other]);
});

test('an output tail names the lines it hides', () => {
  const text = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join('\n');
  const tail = executionOutputTail(text);
  assert.ok(tail);
  assert.equal(tail.hiddenLines, 10);
  assert.match(tail.tail, /^line 11/);
  assert.match(tail.tail, /line 50$/);
  assert.equal(executionOutputTail('short'), null);
  assert.equal(executionOutputTail(''), null);
});

test('short durations are the tool cards’ form, and a flash shows none', () => {
  assert.equal(formatExecutionDuration(99), null);
  assert.equal(formatExecutionDuration(2_400), '2.4s');
  assert.equal(formatExecutionDuration(185_000), '3m 5s');
});
