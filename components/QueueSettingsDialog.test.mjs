import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { QueueSettingsDialog } = await jiti.import('./QueueSettingsDialog.tsx');

const CONFIG = {
  model: { provider: 'anthropic', modelId: 'claude-sonnet-4' },
  verifyCommands: ['bun run typecheck'],
  verifyTimeoutMs: 600_000,
  taskTimeoutMs: 3_600_000,
  allowAskUser: true,
  autoCommit: false,
  commitMessage: 'chore(task): #{id} {title}'
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

test('the dialog opens with the stored defaults, in the units the form shows', () => {
  const markup = render();
  assert.match(markup, /Queue defaults/);
  // Milliseconds become minutes, and the command list keeps its line breaks.
  assert.match(markup, /value="60"/);
  assert.match(markup, /value="10"/);
  assert.match(markup, /bun run typecheck/);
  assert.match(markup, /chore\(task\): #\{id\} \{title\}/);
  assert.match(markup, /Claude Sonnet 4/);
});

test('the question and commit defaults read as plain on/off choices', () => {
  const markup = render();
  // Questions: enabled in the config, so "yes" is the selected option.
  assert.match(markup, /<option value="yes" selected="">Enabled<\/option>/);
  assert.match(markup, /<option value="no" selected="">Disabled<\/option>/);
});

test('no models is stated, not rendered as an empty selector', () => {
  const markup = render({ modelOptions: [] });
  assert.match(markup, /No models are available right now\./);
  assert.doesNotMatch(markup, /role="listbox"/);
});
