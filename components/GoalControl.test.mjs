import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { GoalControl } = await jiti.import('./GoalControl.tsx');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');

const goal = (overrides = {}) => ({
  version: 1,
  objective: 'Ship the parser fix',
  status: 'active',
  continuations: 2,
  startedAt: 1,
  baselineTokens: 100,
  ...overrides
});

function render(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

const control = (props) =>
  React.createElement(GoalControl, {
    running: false,
    busy: false,
    onCommand: () => {},
    onStop: () => {},
    ...props
  });

test('the goal entry sits quiet until a goal exists', () => {
  const html = render(control({}));
  assert.match(html, /class="goal-trigger"/);
  assert.match(html, /data-state="idle"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, />Goal</);
  assert.doesNotMatch(html, /goal-trigger-state/);
  assert.doesNotMatch(html, /role="dialog"/);
});

test('a running goal marks the entry and names its state without relying on color', () => {
  const html = render(control({ goal: goal(), running: true, busy: true }));
  assert.match(html, /data-state="active"/);
  assert.match(html, /class="goal-trigger-state">Running</);
  assert.match(html, /aria-label="Goal: Running\. Ship the parser fix"/);
});

test('other states keep the entry unhighlighted but still named', () => {
  for (const [status, label] of [
    ['paused', 'Paused'],
    ['completed', 'Done'],
    ['blocked', 'Blocked']
  ]) {
    const html = render(control({ goal: goal({ status }) }));
    assert.match(html, /data-state="idle"/, status);
    assert.match(html, new RegExp(`class="goal-trigger-state">${label}<`), status);
  }
});
