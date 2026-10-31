import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { GoalSection } = await jiti.import('./GoalSection.tsx');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');

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
        ...props
      })
    )
  );

test('a session without a goal is asked for one', () => {
  const html = section({});
  assert.doesNotMatch(html, /class="goal-current"/);
  assert.match(html, /What should be achieved\?/);
  assert.doesNotMatch(html, /disabled=""/);
  assert.match(html, /Start goal/);
  // Nothing exists yet, so nothing can be paused, resumed or cleared.
  assert.doesNotMatch(html, /Clear goal|Mark done|Resume goal|Pause goal/);
});

test('a running goal shows its state, its count and no edit', () => {
  const html = section({
    goal: { status: 'active', objective: 'Add CSV export', tokensUsed: 12_345 },
    running: true,
    busy: true
  });
  assert.match(html, /class="goal-current" data-state="active"/);
  assert.match(html, /Running/);
  assert.match(html, /12,345 tokens/);
  // The run holds the objective: it is read, not rewritten, and Stop is the way out.
  assert.match(html, /<textarea[^>]*disabled=""/);
  assert.match(html, /Pause the goal before editing its objective\./);
  assert.match(html, /Stop run/);
  assert.match(html, /disabled=""[^>]*>Update goal|Update goal/);
});

test('a paused goal can be resumed, finished or cleared', () => {
  const html = section({
    goal: { status: 'paused', objective: 'Add CSV export' },
    focusObjective: true
  });
  assert.match(html, /Paused/);
  assert.match(html, /Resume goal/);
  assert.match(html, /Mark done/);
  assert.match(html, /Clear goal/);
  assert.doesNotMatch(html, /<textarea[^>]*disabled/);
  assert.match(html, /Update goal/);
});

test('a finished goal keeps only the ways out', () => {
  const html = section({
    goal: { status: 'complete', objective: 'Add CSV export', tokensUsed: 0 }
  });
  assert.match(html, /Done/);
  assert.match(html, /Clear goal/);
  assert.doesNotMatch(html, /Mark done|Resume goal|Pause goal|Stop run/);
});

test('the package status words each read as their own label', () => {
  const limited = section({ goal: { status: 'budgetLimited', objective: 'Add CSV export' } });
  assert.match(limited, /Budget reached/);
  assert.match(limited, /Resume goal/);

  // A word this build does not know is shown as the package wrote it.
  const unknown = section({ goal: { status: 'awaiting-review', objective: 'Add CSV export' } });
  assert.match(unknown, /awaiting-review/);
  assert.match(unknown, /Resume goal/);
});

test('a budget, when the package set one, reads beside the count', () => {
  const html = section({
    goal: { status: 'paused', objective: 'Add CSV export', tokensUsed: 500, tokenBudget: 2_000 }
  });
  assert.match(html, /500 of 2,000 tokens/);
});
