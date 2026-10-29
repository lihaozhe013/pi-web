import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { GoalSection } = await jiti.import('./GoalSection.tsx');
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

const section = (props) =>
  renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(GoalSection, {
        running: false,
        busy: false,
        focusObjective: false,
        onCommand: () => {},
        onStop: () => {},
        onDone: () => {},
        ...props
      })
    )
  );

test('a new goal starts empty, at the stored depth, with its depth shortcuts', () => {
  const html = section({});
  assert.match(html, /What should be achieved\?/);
  assert.doesNotMatch(html, /goal-current/, 'no state card before a goal exists');
  assert.doesNotMatch(html, /name="[^"]*-status"/, 'status is the goal’s, not the draft’s');
  assert.match(html, /Light/);
  assert.match(html, /Standard/);
  assert.match(html, /Deep/);
  // Starting a goal is the action a visitor came to this section for.
  assert.match(html, /hub-button hub-button-primary">Start goal</);
});

test('an existing goal shows its state, its reason and its depth', () => {
  const html = section({
    goal: goal({
      status: 'paused',
      reason: 'tokens',
      limits: { maxContinuations: 8, maxTokens: 200_000, maxElapsedMs: 3_600_000 }
    })
  });
  assert.match(html, /class="goal-current" data-state="paused"/);
  assert.match(html, /goal-current-status">Paused</);
  assert.match(html, /Turn 2 of 8/);
  assert.match(html, /token budget was reached/);
  // Nothing changed yet, so the primary action waits for an edit.
  assert.match(html, /hub-button hub-button-primary" disabled="">Apply</);
  assert.match(html, /Clear goal/);
  assert.match(html, /value="8"/, 'the depth fields show the goal’s own limits');
  assert.match(html, /value="60"/);
});

test('a running goal stops rather than edits, and says why', () => {
  const html = section({ goal: goal(), running: true, busy: true });
  assert.match(html, /<textarea[^>]*disabled=""/, 'the objective waits for the run to end');
  assert.match(html, /Pause the goal before editing its objective\./);
  assert.match(html, /Stop run/);
  assert.match(html, /A run is active\. Stop it to change the goal\./);
});

test('the goal form carries no dialog chrome of its own', () => {
  // The composer hub owns the dialog, its focus trap and its Escape key; a second
  // backdrop here would nest one modal inside another.
  return readFile(new URL('./GoalSection.tsx', import.meta.url), 'utf8').then((source) => {
    assert.doesNotMatch(source, /createPortal/);
    assert.doesNotMatch(source, /role="dialog"/);
    assert.doesNotMatch(source, /goal-backdrop/);
    assert.doesNotMatch(source, /className="goal-actions/);
  });
});
