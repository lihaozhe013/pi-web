import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { composerActivityLabel: label } = await jiti.import('./composer-activity.ts');
/** Echoes the key plus params, so assertions read as intent. */
const t = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);
const call = (id, toolName, input) => ({ type: 'toolCall', toolCallId: id, toolName, input });
const assistant = (...content) => ({ role: 'assistant', content });
const running = (...tools) => ({ kind: 'running_tools', tools });
const thinking = assistant({ type: 'thinking', thinking: 'reasoning' });

test('a single running tool keeps its concrete detail', () => {
  const messages = [assistant(call('r', 'read', { path: 'src/main.ts' }))];
  assert.equal(
    label(running({ id: 'r', name: 'read' }), messages, thinking, false, t),
    'activity.readingFile {"path":"src/main.ts"}'
  );
  assert.equal(
    label(
      running({ id: 'b', name: 'bash' }),
      [],
      assistant(call('b', 'bash', { command: 'bun  run\n test' })),
      false,
      t
    ),
    'activity.runningCommand {"command":"bun run test"}'
  );
  assert.equal(
    label(running({ id: 'e', name: 'edit', progress: '1/2' }), [], null, false, t),
    'chat.runningNamedTool {"name":"edit"} 1/2'
  );
});

test('concurrent calls of one kind collapse into a count', () => {
  const messages = [
    assistant(
      call('a', 'read', { path: 'a.ts' }),
      call('b', 'read', { path: 'b.ts' }),
      call('c', 'read', { path: 'c.ts' })
    )
  ];
  assert.equal(
    label(
      running({ id: 'a', name: 'read' }, { id: 'b', name: 'read' }, { id: 'c', name: 'read' }),
      messages,
      null,
      false,
      t
    ),
    'activity.readingFiles {"count":3}'
  );
  assert.equal(
    label(running({ id: 'a', name: 'bash' }, { id: 'b', name: 'bash' }), [], null, false, t),
    'activity.runningCommands {"count":2}'
  );
});

test('mixed kinds read as one summary and a single member keeps its detail', () => {
  const messages = [
    assistant(
      call('a', 'read', { path: 'a.ts' }),
      call('b', 'read', { path: 'b.ts' }),
      call('s', 'bash', { command: 'bun test' }),
      call('g', 'grep', { pattern: 'foo' })
    )
  ];
  assert.equal(
    label(
      running(
        { id: 'a', name: 'read' },
        { id: 'b', name: 'read' },
        { id: 's', name: 'bash' },
        { id: 'g', name: 'grep' }
      ),
      messages,
      null,
      false,
      t
    ),
    'activity.readingFiles {"count":2} · activity.searchingPattern {"pattern":"foo"} · activity.runningCommand {"command":"bun test"}'
  );
  assert.equal(
    label(
      running({ id: 'a', name: 'read' }, { id: 'b', name: 'read' }, { id: 'e', name: 'edit' }),
      messages,
      null,
      false,
      t
    ),
    'activity.readingFiles {"count":2} · chat.runningNamedTool {"name":"edit"}'
  );
});

test('other tools list their names, capped when there are many', () => {
  const names = ['fetch', 'edit', 'write', 'browse'];
  assert.equal(
    label(running(...names.map((name, index) => ({ id: `t${index}`, name }))), [], null, false, t),
    'chat.runningToolsMore {"names":"fetch, edit","count":2}'
  );
  assert.equal(
    label(running({ id: 'a', name: 'fetch' }, { id: 'b', name: 'edit' }), [], null, false, t),
    'chat.runningTools {"names":"fetch, edit"}'
  );
});

test('a search or listing keeps its concrete pattern and path', () => {
  const messages = [
    assistant(
      call('g', 'grep', { pattern: 'TODO', path: 'lib' }),
      call('f', 'find', { pattern: '*.test.mjs' }),
      call('l', 'ls', { path: 'components' })
    )
  ];
  assert.equal(
    label(running({ id: 'g', name: 'grep' }), messages, null, false, t),
    'activity.searchingPatternIn {"pattern":"TODO","path":"lib"}'
  );
  assert.equal(
    label(running({ id: 'f', name: 'find' }), messages, null, false, t),
    'activity.searchingPattern {"pattern":"*.test.mjs"}'
  );
  assert.equal(
    label(running({ id: 'l', name: 'ls' }), messages, null, false, t),
    'activity.listingPath {"path":"components"}'
  );
});

test('concurrent searches and listings collapse into counts, before the shells', () => {
  const messages = [
    assistant(
      call('g', 'grep', { pattern: 'a' }),
      call('f', 'find', { pattern: 'b' }),
      call('l', 'ls', { path: 'lib' }),
      call('d', 'ls', {}),
      call('s', 'bash', { command: 'bun test' })
    )
  ];
  assert.equal(
    label(
      running(
        { id: 'g', name: 'grep' },
        { id: 'f', name: 'find' },
        { id: 'l', name: 'ls' },
        { id: 'd', name: 'ls' },
        { id: 's', name: 'bash' }
      ),
      messages,
      null,
      false,
      t
    ),
    'activity.searchingCount {"count":2} · activity.listingCount {"count":2} · activity.runningCommand {"command":"bun test"}'
  );
  assert.equal(
    label(running({ id: 'g', name: 'grep' }, { id: 'l', name: 'ls' }), messages, null, false, t),
    'activity.searchingPattern {"pattern":"a"} · activity.listingPath {"path":"lib"}'
  );
});

test('a search or listing without arguments still names the action', () => {
  assert.equal(label(running({ id: 'g', name: 'grep' }), [], null, false, t), 'activity.searching');
  assert.equal(label(running({ id: 'l', name: 'ls' }), [], null, false, t), 'activity.listing');
});

test('uses streamed tool arguments and supports alternate path/command fields', () => {
  for (const field of ['file_path', 'filePath']) {
    assert.equal(
      label(
        running({ id: 'r', name: 'read_file' }),
        [],
        assistant(call('r', 'read_file', { [field]: 'a.ts' })),
        false,
        t
      ),
      'activity.readingFile {"path":"a.ts"}'
    );
  }
  assert.equal(
    label(
      running({ id: 'b', name: 'exec_command' }),
      [],
      assistant(call('b', 'exec_command', { cmd: 'pwd' })),
      false,
      t
    ),
    'activity.runningCommand {"command":"pwd"}'
  );
});

test('falls back safely when tool arguments are not available', () => {
  assert.equal(label(running({ id: 'r', name: 'read' }), [], null, false, t), 'activity.reading');
  assert.equal(
    label(running({ id: 'b', name: 'bash' }), [], null, false, t),
    'chat.runningNamedTool {"name":"bash"}'
  );
  assert.equal(label(running(), [], null, false, t), 'chat.runningTool');
});

test('a call the model is still writing names the tool instead of blanking the row', () => {
  const drafting = (toolName, rawInput) =>
    assistant(
      { type: 'thinking', thinking: 'reasoning' },
      { type: 'toolCall', toolCallId: 'c1', toolName, input: {}, rawInput }
    );
  // After thinking the phase is already null; the streamed call would say nothing at all.
  assert.equal(
    label(null, [], drafting('edit', '{"path":'), false, t),
    'activity.preparingTool {"name":"edit"}'
  );
  // The phase may still name the previous wait while the arguments stream.
  assert.equal(
    label({ kind: 'waiting_model' }, [], drafting('grep', '{"pattern":'), false, t),
    'activity.preparingTool {"name":"grep"}'
  );
  // A call that already runs keeps its own label.
  assert.equal(
    label(running({ id: 'c1', name: 'edit' }), [], drafting('edit', '{"path":'), false, t),
    'chat.runningNamedTool {"name":"edit"}'
  );
});

test('waiting overrides stale thinking or text; compaction overrides everything', () => {
  for (const streamed of [null, thinking, assistant({ type: 'text', text: 'previous answer' })]) {
    assert.equal(
      label({ kind: 'waiting_model' }, [], streamed, false, t),
      'activity.waitingProvider'
    );
    assert.equal(label({ kind: 'waiting_model' }, [], streamed, true, t), 'chat.compacting');
  }
  assert.equal(label(running({ id: 'r', name: 'read' }), [], thinking, true, t), 'chat.compacting');
});

test('only active reasoning says thinking; a visible answer needs no status', () => {
  assert.equal(label(null, [], thinking, false, t), 'activity.thinking');
  assert.equal(label(null, [], assistant({ type: 'text', text: 'answer' }), false, t), null);
  assert.equal(label(null, [], null, false, t), null);
  assert.equal(label({ kind: 'running_command' }, [], null, false, t), 'chat.runningCommand');
});
