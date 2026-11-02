import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { SessionPanelActions } = await jiti.import('./SessionPanelActions.tsx');

function render(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(SessionPanelActions, {
        onOpenHistory() {},
        historyDisabled: false,
        historyTitle: 'Full history',
        onGenerateTitle() {},
        name: {
          label: 'Generate title',
          title: 'Generate a session title',
          disabled: false,
          busy: false,
          tone: 'default'
        },
        onOpenSystem() {},
        systemLoaded: true,
        onOpenTools() {},
        toolsActive: true,
        onOpenBranches: null,
        stats: {
          tokens: { input: 1200, output: 3400, cacheRead: 12000 },
          cost: 0.042,
          contextPercent: 42,
          contextWindow: 200000,
          tooltip: 'in: 1,200'
        },
        onOpenStats() {},
        ...overrides
      })
    )
  );
}

test('the session actions live in one labelled group, in the panel order', () => {
  const html = render();
  assert.match(html, /<section class="panel-actions" aria-label="Session actions">/);
  const order = ['history', 'name', 'system', 'tools'].map((action) =>
    html.indexOf(`data-panel-action="${action}"`)
  );
  assert.ok(
    order.every((index) => index >= 0),
    'every action is present'
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    'actions keep their order'
  );
});

test('the title action reports progress and failure in place', () => {
  const busy = render({
    name: { label: 'Generating...', title: 'x', disabled: true, busy: true, tone: 'default' }
  });
  assert.match(busy, /data-panel-action="name" disabled=""/);
  assert.match(busy, /animate-spin/);
  const failed = render({
    name: { label: 'Generation failed', title: 'x', disabled: false, busy: false, tone: 'error' }
  });
  assert.match(failed, /data-panel-action="name" data-tone="error"/);
});

test('full history is disabled until the session is saved', () => {
  assert.match(render(), /data-panel-action="history" title="Full history"/);
  const unsaved = render({
    historyDisabled: true,
    historyTitle: 'Full history is available after the session is saved'
  });
  assert.match(unsaved, /data-panel-action="history" disabled=""/);
});

test('dialog openers announce a dialog, and no action pretends to be a toggle', () => {
  const html = render({ onOpenBranches() {} });
  const tagOf = (action) => {
    const at = html.indexOf(`data-panel-action="${action}"`);
    assert.ok(at >= 0, `${action} exists`);
    return html.slice(at, html.indexOf('>', at));
  };
  for (const action of ['system', 'tools', 'branches', 'stats']) {
    assert.match(tagOf(action), /aria-haspopup="dialog"/, `${action} announces its dialog`);
  }
  // History leaves the page for its own window; generate title only edits.
  assert.doesNotMatch(tagOf('history'), /aria-haspopup/);
  assert.doesNotMatch(tagOf('name'), /aria-haspopup/);
  for (const action of ['history', 'name', 'system', 'tools', 'branches', 'stats']) {
    assert.doesNotMatch(tagOf(action), /aria-pressed/, `${action} is not a toggle`);
  }
});

test('a dialog with content shows its icon in the accent color', () => {
  const html = render();
  assert.match(html, /data-panel-action="system"[^>]*data-loaded="true"/);
  assert.match(html, /data-panel-action="tools"[^>]*data-loaded="true"/);
  const empty = render({ systemLoaded: false, toolsActive: false });
  assert.doesNotMatch(empty, /data-loaded="true"/);
});

test('branches appear only when the session has them', () => {
  assert.doesNotMatch(render(), /data-panel-action="branches"/);
  assert.match(render({ onOpenBranches() {} }), /data-panel-action="branches" title="Branches"/);
});

test('the session numbers stay one quiet card that opens the details', () => {
  const html = render();
  assert.match(html, /data-panel-action="stats"/);
  assert.match(html, /panel-stats-label">Input<\/span>/);
  assert.match(html, /1\.2k/);
  assert.match(html, /12k/);
  assert.match(html, />\$0\.04</);
  assert.match(html, /84k \/ 200k/);
  assert.match(html, /class="panel-stats-bar-fill"[^>]*style="width:42%"/);
  assert.doesNotMatch(render({ stats: null }), /data-panel-action="stats"/);

  const withTokens = render({
    stats: {
      tokens: null,
      cost: 0,
      contextTokens: 12500,
      contextPercent: null,
      contextWindow: 200000,
      tooltip: ''
    }
  });
  assert.match(withTokens, /12\.5k \/ 200k/);
  assert.match(withTokens, /class="panel-stats-bar-fill"[^>]*style="width:6\.25%"/);
});

test('an unreadable context reports no percentage instead of a fake bar', () => {
  const unknown = render({
    stats: {
      tokens: null,
      cost: 0,
      contextPercent: null,
      contextWindow: 200000,
      tooltip: 'context: unknown'
    }
  });
  assert.match(unknown, /data-panel-action="stats"/);
  assert.doesNotMatch(unknown, /panel-stats-bar/);
  assert.match(unknown, /—/);
});
