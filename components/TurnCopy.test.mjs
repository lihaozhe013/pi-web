import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: 'automatic' },
  tsconfigPaths: true
});
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { TurnCopy, TurnCopyDialogContent } = await jiti.import('./TurnCopy.tsx');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');

test('the copy dialog offers the three scopes and their descriptions', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(TurnCopyDialogContent, {
        onClose() {},
        onCopy() {}
      })
    )
  );
  const labels = Array.from(html.matchAll(/aria-label="([^"]+)"/g)).map((match) => match[1]);
  assert.deepEqual(labels.slice(1), ['Conversation', 'Kept record', 'Execution log']);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /without tool calls/);
  assert.match(html, /successful shell and codemode calls/);
});

test('a turn shows one copy entry, and no dialog until it is opened', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(TurnCopy, { messages: [{ role: 'user', content: 'hi' }] })
    )
  );
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, />Copy turn…</);
  assert.doesNotMatch(html, /role="dialog"/);
});

test('a failed copy stays in the dialog and names the reason', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(TurnCopyDialogContent, {
        onClose() {},
        onCopy() {},
        busy: false,
        error: 'Clipboard blocked'
      })
    )
  );
  assert.match(html, /role="alert"[^>]*>Clipboard blocked</);
});

test('every choice waits while a copy is in flight', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(TurnCopyDialogContent, { onClose() {}, onCopy() {}, busy: true })
    )
  );
  assert.equal((html.match(/disabled=""/g) ?? []).length, 4);
});
