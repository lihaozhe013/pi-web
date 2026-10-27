import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { createStreamingStore } = await jiti.import('@/lib/streaming-message');
const { ComposerActivity } = await jiti.import('./ComposerActivity.tsx');

const source = await readFile(new URL('./ComposerActivity.tsx', import.meta.url), 'utf8');
const chatWindow = await readFile(new URL('./ChatWindow.tsx', import.meta.url), 'utf8');
const globals = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');

const assistant = (...content) => ({ role: 'assistant', content });

function render({
  running = true,
  phase = null,
  compacting = false,
  messages = [],
  snapshot
} = {}) {
  const store = createStreamingStore();
  if (snapshot) store.dispatch({ type: 'snapshot', message: snapshot });
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ComposerActivity, {
        store,
        phase,
        messages,
        compacting,
        running
      })
    )
  );
}

test('the row is mounted whether a run is on or not', () => {
  // Always in the composer stack: gating it in ChatWindow would move the input
  // when a run starts or ends.
  assert.doesNotMatch(chatWindow, /agentRunning && \(\s*<div className="composer-activity-slot"/);
  assert.match(chatWindow, /<ComposerActivity[\s\S]{0,300}running=\{agentRunning\}/);

  const idle = render({ running: false });
  assert.match(idle, /class="composer-activity-slot"/);
  assert.doesNotMatch(idle, /data-open/, 'a closed row takes no height');
  assert.doesNotMatch(idle, /data-visible/, 'and says nothing');
  assert.doesNotMatch(idle, /composer-activity-tokens/, 'and shows no count');
});

test('a running row opens and names what the agent is doing', () => {
  const waiting = render({ running: true, phase: { kind: 'waiting_model' } });
  assert.match(waiting, /data-open="true"/);
  assert.match(waiting, /data-visible="true"/);
  assert.match(waiting, /role="status" aria-live="polite"/);
  assert.doesNotMatch(waiting, /composer-activity-tokens/, 'nothing streams during a wait');
  // A visible answer drops the text but keeps the row's height, so the composer
  // does not move while the answer streams; its count is the header's job.
  const answering = render({ running: true, snapshot: assistant({ type: 'text', text: 'hi' }) });
  assert.match(answering, /data-open="true"/);
  assert.doesNotMatch(answering, /data-visible="true"/, 'the row stays, its words go');
  assert.doesNotMatch(answering, /composer-activity-tokens/);
});

test('the row folds while its words fade, instead of popping out of the stack', () => {
  assert.match(globals, /\.composer-activity-slot \{[\s\S]*?grid-template-rows: 0fr/);
  assert.match(
    globals,
    /\.composer-activity-slot\[data-open='true'\] \{\s*grid-template-rows: 1fr/
  );
  assert.match(
    globals,
    /\.composer-activity-slot\[data-fading='true'\] \.composer-activity \{\s*opacity: 0/
  );
  // Every change of words rises into place rather than swapping.
  assert.match(source, /<span className="composer-activity-label" key=\{text\}>/);
  assert.match(globals, /@keyframes composer-activity-in/);
  // Both motions are in the reduced-motion block.
  const reduced = globals.slice(
    globals.indexOf(
      '@media (prefers-reduced-motion: reduce)',
      globals.indexOf('.composer-activity-slot')
    )
  );
  assert.match(reduced, /\.composer-activity-label \{\s*animation: none/);
  assert.match(reduced, /\.composer-activity-slot,?\s*\.composer-activity/);
  // The count stays put while the words move and never animates.
  const tokensRule = globals.match(/\.composer-activity-tokens \{[^}]*\}/);
  assert.match(tokensRule[0], /flex-shrink: 0/, 'a truncating label cannot push the count out');
  assert.match(tokensRule[0], /tabular-nums/, 'stable digit widths keep a ticking count calm');
  assert.doesNotMatch(tokensRule[0], /animation/);
});

test('streaming thinking grows its own count beside the label', () => {
  const html = render({ snapshot: assistant({ type: 'thinking', thinking: 'x'.repeat(40) }) });
  assert.match(html, /data-visible="true"/);
  assert.match(html, /Thinking…/);
  assert.match(html, /~10 tokens/);
});

test('a call being written shows its arguments counting up', () => {
  const html = render({
    snapshot: assistant({
      type: 'toolCall',
      toolCallId: 'c1',
      toolName: 'edit',
      input: {},
      rawInput: '{"path":'
    })
  });
  assert.match(html, /Preparing edit/);
  assert.match(html, /~2 tokens/);
});

test('one executing call freezes at its arguments; a group shows no number', () => {
  const single = render({
    phase: { kind: 'running_tools', tools: [{ id: 'r1', name: 'read' }] },
    messages: [
      assistant({ type: 'toolCall', toolCallId: 'r1', toolName: 'read', input: { path: 'abcd' } })
    ]
  });
  assert.match(single, /Reading abcd/);
  assert.match(single, /~4 tokens/);
  const grouped = render({
    phase: {
      kind: 'running_tools',
      tools: [
        { id: 'a', name: 'read' },
        { id: 'b', name: 'read' }
      ]
    },
    messages: [
      assistant(
        { type: 'toolCall', toolCallId: 'a', toolName: 'read', input: { path: 'abcd' } },
        { type: 'toolCall', toolCallId: 'b', toolName: 'read', input: { path: 'abcd' } }
      )
    ]
  });
  assert.doesNotMatch(grouped, /composer-activity-tokens/);
});

test('a running call without its arguments yet shows no count', () => {
  const html = render({ phase: { kind: 'running_tools', tools: [{ id: 'b1', name: 'bash' }] } });
  assert.match(html, /Running bash/);
  assert.match(html, /composer-activity-dot/);
  assert.doesNotMatch(html, /composer-activity-tokens/);
});

test('the row carries the live speed once the reply has streamed for a moment', () => {
  // A single static render can only anchor the measurement: dividing needs
  // elapsed time, which the estimator's own tests cover.
  const html = render({ snapshot: assistant({ type: 'thinking', thinking: 'x'.repeat(40) }) });
  assert.doesNotMatch(html, /composer-activity-rate/);
  assert.match(source, /<span className="composer-activity-rate"/);
  assert.match(source, /t\('activity\.tokenRate'/);
  // The rate reads as a quiet sibling of the count, never a colored badge.
  const rateRule = globals.match(/\.composer-activity-rate \{[^}]*\}/);
  assert.ok(rateRule, 'the rate has its own rule');
  assert.match(rateRule[0], /flex-shrink: 0/, 'a truncating label cannot push it out');
  assert.match(rateRule[0], /tabular-nums/, 'stable digit widths keep it calm');
  assert.doesNotMatch(rateRule[0], /animation/);
});
