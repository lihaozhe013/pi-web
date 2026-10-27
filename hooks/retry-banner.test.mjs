import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { Script, createContext } from 'node:vm';
import { astNodes, nodeText, parseSource } from '../lib/source-testing.mjs';

const source = await readFile(new URL('./useAgentSession.ts', import.meta.url), 'utf8');
const nodes = astNodes(parseSource(source, 'useAgentSession.ts'));

// The event handler's cases for one run that fails, waits and retries.
const cases = ['agent_end', 'auto_retry_start', 'agent_start', 'auto_retry_end'].map((type) => {
  const clause = nodes.find(
    (node) =>
      node.type === 'SwitchCase' && node.test?.type === 'Literal' && node.test.value === type
  );
  assert.ok(clause, `missing case ${type}`);
  return nodeText(source, clause);
});
const handler = new Script(
  stripTypeScriptTypes(`((event) => { switch (event.type) { ${cases.join('\n')} } })`)
);

function setup() {
  const banner = { current: null };
  const context = createContext({
    agentRunningRef: { current: true },
    sdkAgentActiveRef: { current: true },
    sessionIdRef: { current: null },
    setRetryInfo: (value) => {
      banner.current = value;
    },
    cancelEventStreamGrace() {},
    setAgentRunning() {},
    setAgentPhase() {},
    dispatch() {}
  });
  return { handle: handler.runInContext(context), banner };
}

test('the retry banner shows while a retry waits and goes once the retried run starts', () => {
  const { handle, banner } = setup();
  handle({ type: 'agent_end', willRetry: true });
  handle({
    type: 'auto_retry_start',
    attempt: 1,
    maxAttempts: 3,
    delayMs: 2000,
    errorMessage: 'overloaded'
  });
  assert.deepEqual(
    { ...banner.current },
    { attempt: 1, maxAttempts: 3, errorMessage: 'overloaded' }
  );
  // pi emits the successful auto_retry_end only after the retry's first complete reply.
  handle({ type: 'agent_start' });
  assert.equal(banner.current, null);
  handle({ type: 'auto_retry_end', success: true, attempt: 1 });
  assert.equal(banner.current, null);
});
