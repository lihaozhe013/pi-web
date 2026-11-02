import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { WorkspaceSwitch } = await jiti.import('./WorkspaceSwitch.tsx');

function render(mode) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(WorkspaceSwitch, { mode }))
  );
}

test('one workspace control holds both views, each with its own URL', () => {
  const html = render('chat');
  assert.equal((html.match(/data-workspace-option=/g) ?? []).length, 2);
  assert.match(html, /data-workspace-option="chat"[^>]*href="\/"/);
  assert.match(html, /data-workspace-option="tasks"[^>]*href="\/\?mode=tasks"/);
});

test('only the open view is current, so the choice is not color alone', () => {
  const chat = render('chat');
  const tasks = render('tasks');
  assert.match(chat, /data-workspace-option="chat"[^>]*aria-current="page"/);
  assert.doesNotMatch(chat, /data-workspace-option="tasks"[^>]*aria-current/);
  assert.match(tasks, /data-workspace-option="tasks"[^>]*aria-current="page"/);
  assert.doesNotMatch(tasks, /data-workspace-option="chat"[^>]*aria-current/);
});

test('the control is a labelled navigation landmark with readable names', () => {
  const html = render('chat');
  assert.match(html, /<nav class="workspace-switch" aria-label="Workspace view">/);
  assert.match(html, /<span>Chat<\/span>/);
  assert.match(html, /<span>Tasks<\/span>/);
});
