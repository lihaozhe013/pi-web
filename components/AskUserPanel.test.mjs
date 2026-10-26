import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { AskUserPanel, isAskUserRequest } = await jiti.import('./AskUserPanel.tsx');

const request = {
  type: 'extension_ui_request',
  id: 'question-1',
  method: 'select',
  title: 'Which layout?',
  options: ['Sidebar', 'Tabs', 'Write my own answer…'],
  question: { options: ['Sidebar', 'Tabs'] }
};

test('only explicitly tagged questions use the inline panel', () => {
  assert.equal(isAskUserRequest(request), true);
  assert.equal(isAskUserRequest({ ...request, question: undefined }), false);
  assert.equal(isAskUserRequest({ ...request, method: 'confirm' }), false);
  assert.equal(isAskUserRequest({ ...request, method: 'input' }), true);
});

function render(value) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(AskUserPanel, {
        request: value,
        waitingCount: 0,
        onRespond: async () => {},
        onReturnFocus() {}
      })
    )
  );
}

test('options and a labelled free-form answer share one non-modal panel', () => {
  const html = render(request);
  assert.match(html, /Which layout\?/);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 2);
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /<textarea[^>]*id=/);
  assert.match(html, /Or write your own answer/);
  assert.match(html, /type="submit"[^>]*disabled/);
  assert.doesNotMatch(html, /role="dialog"|Write my own answer…|Maximize/);
});

test('open questions render an answer field without a selector', () => {
  const html = render({ ...request, method: 'input', question: { options: [] } });
  assert.doesNotMatch(html, /type="radio"|radiogroup/);
  assert.match(html, /Your answer/);
  assert.match(html, /Skip this question/);
});
