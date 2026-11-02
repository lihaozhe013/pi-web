import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { QueueSettingsDialog, timeoutDraftFrom, timeoutMsFrom } = await jiti.import(
  './QueueSettingsDialog.tsx'
);

const CONFIG = {
  model: { provider: 'anthropic', modelId: 'claude-sonnet-4' },
  verifyCommands: ['bun run typecheck'],
  verifyTimeoutMs: 600_000,
  taskTimeoutMs: 3_600_000,
  allowAskUser: true,
  instructions: 'Commit when the task is done.'
};

const MODELS = [
  { provider: 'anthropic', modelId: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
  { provider: 'openai', modelId: 'gpt-5', name: 'GPT-5' }
];

function render(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(QueueSettingsDialog, {
        config: CONFIG,
        modelOptions: MODELS,
        defaultModelLabel: 'Claude Sonnet 4',
        onClose() {},
        onSaved() {},
        ...overrides
      })
    )
  );
}

test('a stored timeout shows in the largest unit that divides it', () => {
  assert.deepEqual(timeoutDraftFrom(3_600_000, 0), {
    amount: '1',
    unit: 'hours',
    unlimited: false
  });
  assert.deepEqual(timeoutDraftFrom(600_000, 0), {
    amount: '10',
    unit: 'minutes',
    unlimited: false
  });
  assert.deepEqual(timeoutDraftFrom(5_400_000, 0), {
    amount: '90',
    unit: 'minutes',
    unlimited: false
  });
  // Milliseconds convert to minutes when no whole hour fits.
  assert.deepEqual(timeoutDraftFrom(90_000, 0), {
    amount: '1.5',
    unit: 'minutes',
    unlimited: false
  });
});

test('no limit is a null timeout, and an empty amount is not one', () => {
  assert.equal(timeoutDraftFrom(null, 2_400_000).unlimited, true);
  assert.equal(timeoutMsFrom({ amount: '60', unit: 'minutes', unlimited: false }), 3_600_000);
  assert.equal(timeoutMsFrom({ amount: '2', unit: 'hours', unlimited: false }), 7_200_000);
  assert.equal(timeoutMsFrom({ amount: '0', unit: 'minutes', unlimited: false }), null);
  assert.equal(timeoutMsFrom({ amount: 'abc', unit: 'minutes', unlimited: false }), null);
  assert.equal(timeoutMsFrom({ amount: '60', unit: 'minutes', unlimited: true }), null);
});

test('the dialog opens with the stored defaults, in the unit the person chose', () => {
  const markup = render();
  assert.match(markup, /Queue defaults/);
  // One hour, ten minutes, and the stored commands and instructions.
  assert.match(markup, /value="1"/);
  assert.match(markup, /value="10"/);
  assert.match(markup, /<option value="hours" selected="">hours<\/option>/);
  // The unit lives in the select, so the label stays unit-free.
  assert.match(markup, />Task timeout</);
  assert.doesNotMatch(markup, /Task timeout \(minutes\)/);
  assert.match(markup, /bun run typecheck/);
  assert.match(markup, /Commit when the task is done\./);
  assert.match(markup, /<h3>Task instructions<\/h3>/);
  assert.match(markup, /Restore defaults/);
  assert.equal((markup.match(/>No limit</g) ?? []).length, 2);
});

test('a null timeout renders as no limit with its number disabled', () => {
  const markup = render({ config: { ...CONFIG, taskTimeoutMs: null } });
  assert.match(markup, /disabled="" value="1"/);
  assert.match(markup, /<input type="checkbox" checked=""\/>/);
});

test('the question default reads as a plain on/off choice', () => {
  const markup = render();
  assert.match(markup, /<option value="yes" selected="">Enabled<\/option>/);
  assert.doesNotMatch(markup, /<option value="no" selected="">Disabled<\/option>/);
});

test('no models is stated, not rendered as an empty selector', () => {
  const markup = render({ modelOptions: [] });
  assert.match(markup, /No models are available right now\./);
  assert.doesNotMatch(markup, /role="listbox"/);
});
