import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  composerActivityLabel: label,
  composerActivityTokens: tokensOf,
  createReplyRateEstimator,
  runStartHint
} = await jiti.import('./composer-activity.ts');
const { estimateTokens, createBlockEstimator } = await jiti.import('./token-estimate.ts');
/** Echoes the key plus params, so assertions read as intent. */
const t = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);
const call = (id, toolName, input) => ({ type: 'toolCall', toolCallId: id, toolName, input });
const assistant = (...content) => ({ role: 'assistant', content });
const running = (...tools) => ({ kind: 'running_tools', tools });
const thinking = assistant({ type: 'thinking', thinking: 'reasoning' });
/** A reply pi has stamped: its identity keys the shared rate anchor. */
const reply = (timestamp, thinkingText) => ({
  role: 'assistant',
  provider: 'p',
  model: 'm',
  timestamp,
  content: [{ type: 'thinking', thinking: thinkingText }]
});

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

test('the estimate follows the block the label names, never a total', () => {
  const estimator = createBlockEstimator();
  // Active reasoning: its own count.
  assert.equal(tokensOf(null, [], thinking, false, estimator), estimateTokens('reasoning'));
  // A call being written: its arguments, not the reply's history before them.
  const drafting = assistant(
    { type: 'thinking', thinking: 'reasoning' },
    { type: 'toolCall', toolCallId: 'c1', toolName: 'read', input: {}, rawInput: '{"path":"src' }
  );
  assert.equal(tokensOf(null, [], drafting, false, estimator), estimateTokens('{"path":"src'));
});

test('one executing call freezes at what its arguments cost', () => {
  const estimator = createBlockEstimator();
  const input = { path: 'src/main.ts' };
  const expected = estimateTokens(JSON.stringify(input));
  const messages = [assistant(call('r', 'read', input))];
  // After message_end the stream is closed: the count comes from the transcript.
  assert.equal(
    tokensOf(running({ id: 'r', name: 'read' }), messages, null, false, estimator),
    expected
  );
  // While the reply still streams, the same call is found there.
  assert.equal(
    tokensOf(
      running({ id: 'r', name: 'read' }),
      [],
      assistant(call('r', 'read', input)),
      false,
      estimator
    ),
    expected
  );
});

test('a number needs a single named call or live reasoning', () => {
  const estimator = createBlockEstimator();
  const messages = [
    assistant(call('a', 'read', { path: 'a.ts' }), call('b', 'read', { path: 'b.ts' }))
  ];
  // A grouped row names several calls: no single number applies.
  assert.equal(
    tokensOf(
      running({ id: 'a', name: 'read' }, { id: 'b', name: 'read' }),
      messages,
      null,
      false,
      estimator
    ),
    null
  );
  assert.equal(tokensOf(running(), [], null, false, estimator), null);
  // The label prefers the wait over stale thinking; so does the number.
  assert.equal(tokensOf({ kind: 'waiting_model' }, [], thinking, false, estimator), null);
  assert.equal(tokensOf({ kind: 'running_command' }, [], null, false, estimator), null);
  // Compaction holds the turn: nothing here is the model's output.
  assert.equal(tokensOf(null, [], thinking, true, estimator), null);
  // A visible answer's count lives in the transcript header, not here.
  assert.equal(
    tokensOf(null, [], assistant({ type: 'text', text: 'answer' }), false, estimator),
    null
  );
});

test('the rate measures the reply while its count grows, and only then', () => {
  const rate = createReplyRateEstimator();
  const t0 = 1_000_000;
  // The first look anchors the measurement; too soon to divide yet.
  const short = reply(t0, 'a'.repeat(40)); // 10 estimated tokens
  assert.equal(rate.rate(null, short, false, t0), null);
  // Grown to 120 tokens over 2s: (120 - 10) / 2 = 55 t/s.
  const long = reply(t0, 'a'.repeat(480));
  assert.equal(rate.rate(null, long, false, t0 + 2000), 55);
});

test('a new reply restarts the measurement from its own blocks', () => {
  const rate = createReplyRateEstimator();
  const t0 = 2_000_000;
  assert.equal(rate.rate(null, reply(t0, 'a'.repeat(40)), false, t0), null);
  // A different reply, not a growth of the last one.
  const second = reply(t0 + 60_000, 'b'.repeat(480));
  assert.equal(rate.rate(null, second, false, t0 + 60_000 + 1000), null);
  const grown = reply(t0 + 60_000, 'b'.repeat(880));
  assert.equal(rate.rate(null, grown, false, t0 + 60_000 + 3000), 50);
});

test('the rate shows only while the model writes', () => {
  const rate = createReplyRateEstimator();
  const t0 = 3_000_000;
  rate.rate(null, reply(t0, 'a'.repeat(200)), false, t0); // anchor
  const grown = reply(t0, 'a'.repeat(600));
  // The label prefers the wait over stale thinking; so does the rate.
  assert.equal(rate.rate({ kind: 'waiting_model' }, grown, false, t0 + 2000), null);
  // Compaction holds the turn: nothing here is the model's output.
  assert.equal(rate.rate(null, grown, true, t0 + 2000), null);
  // While a call executes the model is silent and the count is frozen.
  assert.equal(rate.rate(running({ id: 'r', name: 'read' }), grown, false, t0 + 2000), null);
  // A visible answer needs no status.
  assert.equal(
    rate.rate(
      null,
      { ...reply(t0, 'a'.repeat(40)), content: [{ type: 'text', text: 'hi' }] },
      false,
      t0 + 2000
    ),
    null
  );
  // A call being written streams too, even while the phase still names the wait.
  const draftingAt = t0 + 10_000;
  const drafting = (rawInput) => ({
    ...reply(draftingAt, ''),
    content: [{ type: 'toolCall', toolCallId: 'c', toolName: 'edit', input: {}, rawInput }]
  });
  rate.rate({ kind: 'waiting_model' }, drafting('{"path":'), false, draftingAt);
  assert.ok(
    rate.rate({ kind: 'waiting_model' }, drafting('{"path":"src'), false, draftingAt + 2000) > 0
  );
});

test('the run clock counts from the latest prompt that carries a time', () => {
  const user = (timestamp) => ({ role: 'user', content: 'hi', timestamp });
  // Only the last user message matters: an attached run began at its prompt,
  // whatever the replies in between recorded.
  assert.equal(
    runStartHint([
      user(1_000),
      assistant({ type: 'thinking', thinking: 'x' }),
      user(60_000),
      assistant({ type: 'text', text: 'done' })
    ]),
    60_000
  );
  // Replies never anchor the clock, only prompts do.
  assert.equal(runStartHint([reply(5_000, 'reasoning')]), null);
  assert.equal(runStartHint([]), null);
  assert.equal(runStartHint([user(undefined)]), null);
});
