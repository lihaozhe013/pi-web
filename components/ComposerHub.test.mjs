import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { ComposerHub } = await jiti.import('./ComposerHub.tsx');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');

const source = await readFile(new URL('./ComposerHub.tsx', import.meta.url), 'utf8');
const sheet = await readFile(new URL('../app/composer-hub.css', import.meta.url), 'utf8');
const chatInput = await readFile(new URL('./ChatInput.tsx', import.meta.url), 'utf8');

const goal = (overrides = {}) => ({
  version: 1,
  objective: 'Ship the parser fix',
  status: 'active',
  continuations: 2,
  startedAt: 1,
  baselineTokens: 100,
  ...overrides
});

const hub = (props) =>
  renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ComposerHub, {
        running: false,
        busy: false,
        iconOnly: false,
        onGoalCommand: () => {},
        onCompact: () => {},
        ...props
      })
    )
  );

test('the entry stays quiet until a goal exists, and says what it opens', () => {
  const html = hub({});
  assert.match(html, /class="composer-hub-trigger"/);
  assert.match(html, /data-state="idle"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  // No goal, no state word: the entry is the overflow it reads as.
  assert.match(html, />More</);
  assert.doesNotMatch(html, /composer-hub-trigger-state/);
  assert.doesNotMatch(html, /role="dialog"/);
});

test('a goal names itself and its state without relying on color', () => {
  const html = hub({ goal: goal(), running: true, busy: true });
  assert.match(html, /data-state="active"/);
  assert.match(html, />Goal</);
  assert.match(html, /class="composer-hub-trigger-state">Running</);
  // The tooltip keeps the whole goal, so the state word is not all a pointer gets.
  assert.match(html, /title="Goal and context · Running: Ship the parser fix"/);
});

test('other states keep the entry unhighlighted but still named', () => {
  for (const [status, label] of [
    ['paused', 'Paused'],
    ['completed', 'Done'],
    ['blocked', 'Blocked']
  ]) {
    const html = hub({ goal: goal({ status }) });
    assert.match(html, /data-state="idle"/, status);
    assert.match(html, new RegExp(`composer-hub-trigger-state">${label}<`), status);
  }
});

test('a phone shows the icon alone, with the state in its accessible name', () => {
  const withGoal = hub({ goal: goal(), running: true, iconOnly: true });
  assert.doesNotMatch(withGoal, /composer-hub-trigger-label/);
  assert.match(withGoal, /aria-label="Goal: Running"/);
  assert.match(withGoal, /composer-hub-trigger-state">Running</);
  const withoutGoal = hub({ iconOnly: true });
  assert.match(withoutGoal, /aria-label="Goal and context"/);
});

test('one dialog holds the goal and the context, each with its own heading', () => {
  // The dialog is portaled, so its structure is asserted on the source; the
  // sections themselves render under GoalSection and the browser tests.
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /<h3 id=\{goalId\}>\{t\('chat\.goal'\)\}<\/h3>/);
  assert.match(source, /<h3 id=\{contextId\}>\{t\('chat\.hubContext'\)\}<\/h3>/);
  // Escape and the backdrop both close it, and focus returns to the entry.
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.target === event\.currentTarget/);
  assert.match(source, /triggerRef\.current\?\.focus\(\)/);
  // The trap covers the goal's own fields, not only the hub's buttons.
  assert.match(
    source,
    /'button:not\(:disabled\), textarea:not\(:disabled\), input:not\(:disabled\)/
  );
});

test('compaction starts from the hub and reports in the run status row', () => {
  assert.match(source, /onCompact\(\);\s*close\(\);/);
  // No compact button survives in the composer footer: the row above it owns
  // that state now, and nothing there morphs into a second progress pill.
  assert.doesNotMatch(chatInput, /t\('chat\.compacting'\)/);
  assert.doesNotMatch(chatInput, /t\('chat\.compact'\)/);
  assert.match(chatInput, /isCompacting && onAbortCompaction/);
  // The dialog renders the compact action, and offers Stop while it runs.
  assert.match(source, /t\('chat\.compactContext'\)/);
  assert.match(source, /t\('chat\.stopCompaction'\)/);
  assert.match(source, /t\('chat\.hubCompactBusy'\)/);
});

test('the entry and the dialog read as one surface', () => {
  for (const selector of [
    '.composer-hub-trigger',
    '.composer-hub-trigger-state',
    '.composer-hub-backdrop',
    '.composer-hub-dialog',
    '.composer-hub-section',
    '.composer-hub-actions'
  ]) {
    assert.ok(sheet.includes(`${selector} {`) || sheet.includes(`${selector}[`), selector);
  }
  // Focus stays visible, and motion explains the opening only.
  assert.match(
    sheet,
    /\.composer-hub-trigger:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/
  );
  assert.match(sheet, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,120}animation: none/);
});
