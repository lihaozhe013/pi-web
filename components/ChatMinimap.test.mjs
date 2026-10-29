import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJiti } from 'jiti';

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.module.css')) return nextLoad(url, context);
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default new Proxy({}, { get: (_, key) => String(key) });'
    };
  }
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: 'automatic' },
  tsconfigPaths: true
});
const { AssistantOutline, ChatMinimap } = await jiti.import('./ChatMinimap.tsx');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');

function renderMinimap(messages) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatMinimap, {
        messages,
        getStreamingMessage: () => null,
        scrollContainer: { current: null },
        messageRefs: { current: [] },
        onRevealHistory() {},
        turnsBefore: 0,
        renderCount: 0
      })
    )
  );
}

const userTurn = (text) => ({ role: 'user', content: text });
const assistantTurn = (text) => ({ role: 'assistant', content: [{ type: 'text', text }] });

test('renders math in headings without disabling heading navigation', () => {
  const html = renderToStaticMarkup(
    React.createElement(AssistantOutline, {
      markdown: String.raw`# Inline $f_{k,t+1}$

## Parentheses \(x^2 + y^2\)`,
      onHeadingClick() {}
    })
  );

  assert.match(html, /class="katex"/);
  assert.match(html, /data-preview-heading-index="0"/);
  assert.match(html, /data-preview-heading-index="1"/);
  assert.doesNotMatch(html, /disabled=""/);
});

// The entry point must not wait for a layout measurement: it is derived from the transcript.
test('keeps the directory entry point whenever the transcript has a turn', () => {
  const html = renderMinimap([userTurn('First question'), assistantTurn('## Answer')]);

  assert.match(html, /data-chat-outline-trigger=""/);
  assert.doesNotMatch(html, /hidden=""/);
  assert.equal(html.match(/data-minimap-marker=""/g)?.length, 1);
});

test('hides the directory only when no message anchors a turn', () => {
  const html = renderMinimap([assistantTurn('Orphan answer')]);

  assert.match(html, /hidden=""/);
  assert.equal(html.match(/data-minimap-marker=""/g)?.length ?? 0, 0);
});

test('samples long transcripts down to the rail maximum', () => {
  const html = renderMinimap(Array.from({ length: 40 }, (_, index) => userTurn(`Turn ${index}`)));

  assert.doesNotMatch(html, /hidden=""/);
  assert.equal(html.match(/data-minimap-marker=""/g)?.length, 18);
});
