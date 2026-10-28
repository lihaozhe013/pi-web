import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { NewSessionContextBar } = await jiti.import('./NewSessionContextBar.tsx');
const context = {
  cwd: '/work/app',
  project: { key: 'app', root: '/work/app' },
  projects: [{ key: 'app', root: '/work/app' }]
};
function render(value = context, mobile = false) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(NewSessionContextBar, {
        context: value,
        mobile,
        initialFocus: null,
        onInitialFocusDone() {},
        onPick() {},
        onStartWithoutProject() {},
        onOpenFolder() {}
      })
    )
  );
}
test('new conversations choose one project directory without worktree controls', () => {
  for (const mobile of [false, true]) {
    const html = render(context, mobile);
    assert.match(html, /title="\/work\/app"/);
    assert.equal((html.match(/aria-haspopup="menu"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /Worktree|feature/);
  }
});
test("the selected project's alias is escaped and its directory remains visible in the tooltip", () => {
  const html = render({ ...context, project: { ...context.project, alias: 'App <Models>' } });
  assert.match(html, /App &lt;Models&gt;/);
});
