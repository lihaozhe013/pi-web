import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { liveAgentActivityLabels: labels } = await jiti.import('./live-agent-activity.ts');
const t = (key, params) => `${key}${params ? ` ${JSON.stringify(params)}` : ''}`;
const call = (id, toolName, input) => ({ type: 'toolCall', toolCallId: id, toolName, input });
const assistant = (...content) => ({ role: 'assistant', content });
const running = (...tools) => ({ kind: 'running_tools', tools });
const thinking = assistant({ type: 'thinking', thinking: 'reasoning' });

test('labels concurrent reads, shells and other tools with their actual inputs', () => {
  const messages = [
    assistant(
      call('r', 'read', { path: 'src/main.ts' }),
      call('b', 'bash', { command: 'bun run\n typecheck' })
    )
  ];
  assert.deepEqual(
    labels(
      running(
        { id: 'r', name: 'read' },
        { id: 'b', name: 'bash' },
        { id: 'e', name: 'edit', progress: '1/2' }
      ),
      messages,
      thinking,
      false,
      t
    ),
    [
      'activity.readingFile {"path":"src/main.ts"}',
      'activity.runningCommand {"command":"bun run typecheck"}',
      'chat.runningNamedTool {"name":"edit"} 1/2'
    ]
  );
});

test('uses streamed tool arguments and supports alternate path/command fields', () => {
  for (const field of ['file_path', 'filePath']) {
    assert.deepEqual(
      labels(
        running({ id: 'r', name: 'read_file' }),
        [],
        assistant(call('r', 'read_file', { [field]: 'a.ts' })),
        false,
        t
      ),
      ['activity.readingFile {"path":"a.ts"}']
    );
  }
  assert.deepEqual(
    labels(
      running({ id: 'b', name: 'exec_command' }),
      [],
      assistant(call('b', 'exec_command', { cmd: 'pwd' })),
      false,
      t
    ),
    ['activity.runningCommand {"command":"pwd"}']
  );
});

test('falls back safely when tool arguments are not available', () => {
  assert.deepEqual(
    labels(running({ id: 'r', name: 'read' }, { id: 'b', name: 'bash' }), [], null, false, t),
    ['activity.reading', 'chat.runningNamedTool {"name":"bash"}']
  );
  assert.deepEqual(labels(running(), [], null, false, t), ['chat.runningTool']);
});

test('waiting overrides stale thinking or text; compaction overrides everything', () => {
  for (const streamed of [null, thinking, assistant({ type: 'text', text: 'previous answer' })]) {
    assert.deepEqual(labels({ kind: 'waiting_model' }, [], streamed, false, t), [
      'activity.waitingProvider'
    ]);
    assert.deepEqual(labels({ kind: 'waiting_model' }, [], streamed, true, t), ['chat.compacting']);
  }
  assert.deepEqual(labels(running({ id: 'r', name: 'read' }), [], thinking, true, t), [
    'chat.compacting'
  ]);
});

test('only active reasoning says thinking; visible answers need no extra status', () => {
  assert.deepEqual(labels(null, [], thinking, false, t), ['activity.thinking']);
  assert.deepEqual(labels(null, [], assistant({ type: 'text', text: 'answer' }), false, t), []);
  assert.deepEqual(labels(null, [], null, false, t), []);
  assert.deepEqual(labels({ kind: 'running_command' }, [], null, false, t), [
    'chat.runningCommand'
  ]);
});
