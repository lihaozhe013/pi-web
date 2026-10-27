import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { NewSessionChooserDialog } = await jiti.import('./NewSessionChooser.tsx');

const h = React.createElement;

function render(props = {}) {
  return renderToStaticMarkup(
    h(
      I18nProvider,
      null,
      h(NewSessionChooserDialog, {
        onClose() {},
        onAddProject() {},
        onStartWithoutProject() {},
        ...props
      })
    )
  );
}

test('the sidebar New dialog offers exactly a project and a conversation without one', () => {
  const html = render();
  const choices = [...html.matchAll(/class="new-session-choice"[^>]*aria-label="([^"]+)"/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(choices, ['Add a project', 'Start without a project']);
  // The old wording asked about "default locations" nobody could picture.
  assert.doesNotMatch(html, /default location|default directory/i);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /id="new-session-chooser-title">New session</);
  // Both cards are described, so the choice is clear before it is made.
  assert.match(html, /aria-describedby="new-session-choice-project-description"/);
  assert.match(html, /aria-describedby="new-session-choice-scratch-description"/);
});

test('preparing the scratch folder disables both choices and reports progress', () => {
  const html = render({ busy: true });
  assert.equal((html.match(/class="new-session-choice"[^>]*disabled=""/g) ?? []).length, 2);
  assert.match(html, /class="new-session-chooser-close"[^>]*disabled=""/);
  assert.match(html, /Preparing a temporary folder…/);
  assert.match(html, /role="status"/);
});

test('a failed scratch start keeps the choices and shows the reason', () => {
  const html = render({ error: 'Permission denied' });
  assert.doesNotMatch(html, /disabled=""/);
  assert.match(html, /<p class="new-session-chooser-error" role="alert">Permission denied<\/p>/);
});
