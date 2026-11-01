import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
  buildExecutionHistory,
  executionOutputTail,
  formatExecutionDuration,
  retainExecutionHistory,
  updateActiveRunHolds
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

test('every other tool call is a run, with its input and output', () => {
  const read = toolCall('r1', 'read', { path: 'src/app.ts', offset: 10 });
  const fetch = toolCall('f1', 'web_fetch', { url: 'https://example.com' });
  const write = toolCall('w1', 'write', { path: 'notes.md', content: 'text' });
  const patch = toolCall('p1', 'apply_patch', { input: '*** Begin Patch\n*** End Patch' });
  const messages = [assistant(read, fetch, write, patch)];
  const results = new Map([
    ['r1', result('r1', 'file body', { durationMs: 80 })],
    ['f1', result('f1', 'page body', { isError: true })],
    ['w1', result('w1', 'written')],
    ['p1', result('p1', 'patched')]
  ]);

  const entries = buildExecutionHistory(messages, results, new Set());

  assert.deepEqual(
    entries.map(({ id, kind, toolName, status }) => ({ id, kind, toolName, status })),
    [
      { id: 'r1', kind: 'tool', toolName: 'read', status: 'success' },
      { id: 'f1', kind: 'tool', toolName: 'web_fetch', status: 'error' }
    ],
    'writes and patches stay in the transcript'
  );
  assert.equal(entries[0].preview, 'src/app.ts');
  assert.equal(entries[0].command, '{\n  "path": "src/app.ts",\n  "offset": 10\n}');
  assert.equal(entries[0].output, 'file body');
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

test('concurrent completions hold independently, but restored history does not', () => {
  const one = { id: 'one', status: 'running' };
  const two = { id: 'two', status: 'running' };
  const done = { ...one, status: 'success' };
  let holds = updateActiveRunHolds([one, two], [done, two], new Map(), 100, 2000);
  assert.equal(holds.get('one'), 2100);
  holds = updateActiveRunHolds([done, two], [done, { ...two, status: 'error' }], holds, 600, 2000);
  assert.deepEqual(
    [...holds],
    [
      ['one', 2100],
      ['two', 2600]
    ]
  );
  holds = updateActiveRunHolds([], [done], holds, 2100, 2000);
  assert.equal(holds.size, 0);
  assert.equal(updateActiveRunHolds([], [done], new Map(), 100, 2000).size, 0);
});

test('a pending user command transfers its hold to the saved result', () => {
  const pending = { id: 'bash-pending', command: 'pwd', status: 'running' };
  const saved = { id: 'bash-1', command: 'pwd', status: 'success', userInitiated: true };
  assert.equal(updateActiveRunHolds([pending], [saved], new Map(), 10, 2000).get('bash-1'), 2010);
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

const WRITE_PATCH = `--- a/notes.md
+++ b/notes.md
@@ -1 +1 @@
-old
+new
`;

test('conversation-only sends writes and patches to the Runs panel with their diff', () => {
  const write = toolCall('w1', 'write', { path: 'notes.md', content: 'new' });
  const patch = toolCall('p1', 'apply_patch', {
    input: '*** Begin Patch\n*** Update File: notes.md\n@@\n-old\n+new\n*** End Patch\n'
  });
  const messages = [assistant(write, patch)];
  const results = new Map([
    ['w1', result('w1', 'Wrote 1 line', { details: { patch: WRITE_PATCH } })],
    ['p1', result('p1', 'Applied')]
  ]);

  assert.deepEqual(
    buildExecutionHistory(messages, results, new Set()).map((entry) => entry.id),
    [],
    'the default display keeps them in the transcript'
  );

  const entries = buildExecutionHistory(messages, results, new Set(), {
    toolDisplay: 'conversation'
  });
  assert.deepEqual(
    entries.map(({ id, kind, toolName, command, preview }) => ({
      id,
      kind,
      toolName,
      command,
      preview
    })),
    [
      { id: 'w1', kind: 'tool', toolName: 'write', command: '', preview: 'notes.md' },
      { id: 'p1', kind: 'tool', toolName: 'apply_patch', command: '', preview: 'notes.md' }
    ],
    'a kept card shows its change, not the arguments that carry the whole file'
  );
  assert.equal(entries[0].output, 'Wrote 1 line');
  assert.deepEqual(
    entries[0].diffFiles.map((file) => file.newPath),
    ['b/notes.md']
  );
  assert.deepEqual(
    entries[1].diffFiles.map((file) => file.newPath),
    ['notes.md']
  );
});

test('a kept-card run without a recorded patch keeps its result and no diff', () => {
  const write = toolCall('w1', 'write', { path: 'big.bin', content: 'x' });
  const entries = buildExecutionHistory(
    [assistant(write)],
    new Map([['w1', result('w1', 'Wrote 1 line')]]),
    new Set(),
    { toolDisplay: 'conversation' }
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].diffFiles, undefined);
  assert.equal(entries[0].preview, 'big.bin');
});
