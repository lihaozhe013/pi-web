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
const goalSheet = await readFile(new URL('../app/goal.css', import.meta.url), 'utf8');
const layout = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const chatInput = await readFile(new URL('./ChatInput.tsx', import.meta.url), 'utf8');

const hub = (props) =>
  renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ComposerHub, { running: false, onCompact: () => {}, ...props })
    )
  );

test('the entry is one quiet opener, and the dialog stays portaled', () => {
  const html = hub({});
  assert.match(html, /class="composer-hub-trigger"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /title="Goal and context"/);
  // Closed, it is the trigger alone.
  assert.doesNotMatch(html, /role="dialog"/);
  // The opener names the hub, not a goal: no state word, no second control.
  assert.doesNotMatch(html, /class="goal/);
  assert.doesNotMatch(html, /Running|Paused|Done/);

  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /createPortal/);
  assert.match(source, /triggerRef\.current\?\.focus\(\)/);
});

test('the dialog opens on Compact and Goal, and a goal opens its own page', () => {
  assert.match(source, /type HubView = 'options' \| 'goal';/);
  assert.match(source, /t\('chat\.hubChooserDescription'\)/);
  assert.match(source, /t\('chat\.goal'\)/);
  // The goal card opens the form instead of acting on the spot.
  assert.match(source, /onClick=\{\(\) => setView\('goal'\)\}/);
  assert.match(source, /<GoalSection/);
  // With nothing to compact, the entry goes straight to the goal.
  assert.match(source, /const goalOnly = Boolean\(onGoalCommand\) && !onCompact;/);
  // A goal page without a way back would trap the dialog on one level.
  assert.match(source, /t\('chat\.hubBack'\)/);
});

test('the goal page reports state and sends commands, never a goal engine', () => {
  assert.match(source, /onCommand=\{onGoalCommand\}/);
  assert.match(source, /onStop=\{\(\) => onGoalStop\?\.\(\)\}/);
  // Both subject cards read from the same props as the rest of the composer.
  assert.match(source, /goal=\{goal\}/);
});

test('compaction starts from its card, and Stop when one is running', () => {
  assert.match(source, /onCompact\(\);\s*close\(\);/);
  assert.match(source, /if \(isCompacting\) onAbortCompaction\?\.\(\);/);
  assert.match(source, /t\('chat\.compactContext'\)/);
  assert.match(source, /t\('chat\.stopCompaction'\)/);
  assert.match(source, /t\('chat\.hubCompactBusy'\)/);
  assert.match(source, /t\('chat\.hubContextUsage'/);
  // A running session holds the context, so the card waits for idle.
  assert.match(source, /const compactBusy = running && !isCompacting;/);
  // No compact button survives in the composer footer either.
  assert.doesNotMatch(chatInput, /t\('chat\.compacting'\)/);
  assert.doesNotMatch(chatInput, /t\('chat\.compact'\)/);
  assert.match(chatInput, /isCompacting && onAbortCompaction/);
});

test('the composer footer has no goal switch of its own', () => {
  // The goal is reached through the hub only, so the footer keeps one opener
  // beside the model picker instead of a second control that shows its state.
  assert.doesNotMatch(chatInput, /GoalToggle|onGoalToggle/);
  assert.match(chatInput, /\{\(onCompact \|\| onGoalCommand\) && \(/);
  assert.match(chatInput, /<ComposerHub[\s\S]{0,400}onGoalCommand=\{onGoalCommand\}/);
});

test('the entry, the dialog and the goal form read as one surface', () => {
  for (const selector of [
    '.composer-hub-trigger',
    '.composer-hub-backdrop',
    '.composer-hub-dialog',
    '.composer-hub-choice',
    '.composer-hub-choice-title',
    '.composer-hub-section'
  ]) {
    assert.ok(sheet.includes(`${selector} {`) || sheet.includes(`${selector}[`), selector);
  }
  assert.match(
    sheet,
    /\.composer-hub-trigger:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/
  );
  for (const selector of ['.goal-current', '.goal-field', '.goal-hint', '.goal-error']) {
    assert.ok(goalSheet.includes(`${selector} {`), selector);
  }
  assert.match(layout, /import '\.\/goal\.css';/);
  assert.match(goalSheet, /@media \(max-width: 520px\)/);
});
