import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { INITIAL_STREAMING_STATE } = await jiti.import('@/lib/streaming-message');
const { ComposerActivity } = await jiti.import('./ComposerActivity.tsx');

const source = await readFile(new URL('./ComposerActivity.tsx', import.meta.url), 'utf8');
const chatWindow = await readFile(new URL('./ChatWindow.tsx', import.meta.url), 'utf8');
const globals = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');

/** A store that never streams: the row's own texts are what these tests read. */
const idleStore = {
  getState: () => INITIAL_STREAMING_STATE,
  subscribe: () => () => {}
};

function render({ running, phase = null, compacting = false }) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ComposerActivity, {
        store: idleStore,
        phase,
        messages: [],
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
});

test('a running row opens and names what the agent is doing', () => {
  const waiting = render({ running: true, phase: { kind: 'waiting_model' } });
  assert.match(waiting, /data-open="true"/);
  assert.match(waiting, /data-visible="true"/);
  assert.match(waiting, /role="status" aria-live="polite"/);
  // A visible answer drops the text but keeps the row's height, so the composer
  // does not move while the answer streams.
  const answering = render({ running: true });
  assert.match(answering, /data-open="true"/);
  assert.doesNotMatch(answering, /data-visible="true"/, 'the row stays, its words go');
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
});
