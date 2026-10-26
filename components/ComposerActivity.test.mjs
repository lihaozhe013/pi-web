import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { createStreamingStore } = await jiti.import('@/lib/streaming-message');
const { ComposerActivity } = await jiti.import('./ComposerActivity.tsx');

const assistant = (...content) => ({ role: 'assistant', content });

function render({ phase = null, snapshot } = {}) {
  const store = createStreamingStore();
  if (snapshot) store.dispatch({ type: 'snapshot', message: snapshot });
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ComposerActivity, { store, phase, messages: [], compacting: false })
    )
  );
}

test('the row keeps its height while a visible answer streams, without text', () => {
  // The composer must not jump under the row when there is nothing to report.
  const html = render({ snapshot: assistant({ type: 'text', text: 'answer' }) });
  assert.match(html, /class="composer-activity"/);
  assert.doesNotMatch(html, /composer-activity-dot/);
  assert.doesNotMatch(html, /composer-activity-label/);
});

test('a tool call the model is still writing names the tool', () => {
  const html = render({
    phase: null,
    snapshot: assistant({
      type: 'toolCall',
      toolCallId: 'c1',
      toolName: 'edit',
      input: {},
      rawInput: '{"path":'
    })
  });
  assert.match(html, /Preparing edit/);
});

test('a running tool keeps its concrete label and its dot', () => {
  const html = render({ phase: { kind: 'running_tools', tools: [{ id: 'b1', name: 'bash' }] } });
  assert.match(html, /Running bash/);
  assert.match(html, /composer-activity-dot/);
});
