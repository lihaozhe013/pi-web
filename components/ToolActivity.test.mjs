import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { MessageView } = await jiti.import('./MessageView.tsx');
const { ToolActivityProvider } = await jiti.import('./ToolActivity.tsx');
const { clearExpandedToolCalls, setToolCallExpanded } = await jiti.import(
  '@/lib/tool-call-expansion'
);
const { TOOL_CARD_BODY_MS, TOOL_CARD_EXIT_MS } = await jiti.import('@/hooks/useToolCardMotion');
const toolCardsCss = readFileSync(new URL('../app/tool-cards.css', import.meta.url), 'utf8');

function render(
  toolName,
  { running = false, partial = false, complete = false, error = false } = {}
) {
  const block = {
    type: 'toolCall',
    toolCallId: 'tool-test',
    toolName,
    input: { path: 'demo.ts', content: 'file-body', command: 'echo hello' }
  };
  const result = {
    role: 'toolResult',
    toolCallId: block.toolCallId,
    content: [{ type: 'text', text: 'result-body' }],
    isError: error
  };
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(
        ToolActivityProvider,
        {
          phase: running ? { kind: 'running_tools', tools: [{ id: block.toolCallId }] } : null,
          partialResults: new Map(partial ? [[block.toolCallId, result]] : [])
        },
        React.createElement(MessageView, {
          message: { role: 'assistant', content: [block] },
          toolResults: new Map(complete || partial ? [[block.toolCallId, result]] : [])
        })
      )
    )
  );
}

/** Streamed arguments: the call exists, it has not started, and has no result. */
function renderStreamingInput(toolName) {
  const block = {
    type: 'toolCall',
    toolCallId: 'tool-test',
    toolName,
    input: {},
    rawInput: '{"path":"demo.ts","content":"file-'
  };
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(
        ToolActivityProvider,
        { phase: null, partialResults: new Map() },
        React.createElement(MessageView, {
          message: { role: 'assistant', content: [block] },
          isStreaming: true,
          toolResults: new Map()
        })
      )
    )
  );
}

test('a call whose arguments are still streaming shows no card', () => {
  clearExpandedToolCalls();
  for (const name of ['write', 'edit', 'bash', 'powershell', 'apply_patch', 'read']) {
    assert.equal(renderStreamingInput(name), '', name);
    // Nothing has run yet, so there is nothing to report.
    assert.equal(render(name), '', name);
  }
});

test('an executing write or edit opens its card; a shell belongs to Runs', () => {
  clearExpandedToolCalls();
  // Shell and codemode cards never reach the transcript, running or finished.
  for (const name of ['bash', 'powershell', 'exec_command', 'codemode']) {
    assert.equal(render(name, { running: true }), '', name);
    assert.equal(render(name, { partial: true }), '', name);
  }
  // A write/edit card is open too: its arguments are complete, only its result is missing.
  for (const name of ['write', 'edit']) {
    const running = render(name, { running: true });
    assert.match(running, /aria-expanded="true"/, name);
    assert.doesNotMatch(running, /shell-running/, name);
  }
  assert.match(render('apply_patch', { running: true }), /aria-expanded="true"/);
  // A running call the user asked to fold stays folded.
  setToolCallExpanded('tool-test', false);
  assert.match(render('write', { running: true }), /aria-expanded="false"/);
  clearExpandedToolCalls();
});

test('a finished card follows its lifecycle default', () => {
  clearExpandedToolCalls();
  for (const name of ['write', 'edit']) {
    assert.match(render(name, { complete: true }), /aria-expanded="true"/);
    assert.match(render(name, { complete: true, error: true }), /aria-expanded="true"/);
  }
  assert.match(render('apply_patch', { complete: true }), /aria-expanded="false"/);
  // Shells keep no card in the transcript, successful or failed.
  assert.equal(render('bash', { complete: true }), '');
  assert.equal(render('bash', { complete: true, error: true }), '');
  assert.equal(render('read', { complete: true }), '');
});

test('an explicit choice still wins on a retained card', () => {
  clearExpandedToolCalls();
  setToolCallExpanded('tool-test', false);
  assert.match(render('write', { complete: true }), /aria-expanded="false"/);
  assert.match(render('apply_patch', { complete: true, error: true }), /aria-expanded="false"/);
  clearExpandedToolCalls();
  setToolCallExpanded('tool-test', true);
  assert.match(render('apply_patch', { complete: true, error: true }), /aria-expanded="true"/);
  clearExpandedToolCalls();
});

test('a command the user ran keeps its live card', () => {
  const run = (props) =>
    renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(MessageView, {
          message: { role: 'bashExecution', command: 'sleep 5', output: '', ...props }
        })
      )
    );

  const running = run({});
  assert.match(running, /sleep 5/);
  assert.match(running, /aria-expanded="true"/);
  assert.match(running, /class="shell-running" role="status"/);

  assert.equal(run({ output: 'done', exitCode: 0 }), '');
  assert.match(run({ output: 'boom', exitCode: 1 }), /Failed/);
});

test('a card that lived in this page moves; a restored one does not', () => {
  clearExpandedToolCalls();
  // The call is running now: this card arrived with the page, so it fades in.
  const live = render('write', { running: true });
  assert.match(live, /class="tool-card" data-state="running" data-live="true"/);
  assert.match(live, /<div class="tool-card-body" data-open="true">/);
  // A card the session file brought back is drawn as it is, with nothing to replay.
  const restored = render('write', { complete: true });
  assert.doesNotMatch(restored, /data-live/);
  assert.match(restored, /<div class="tool-card-body" data-open="true">/);
  // A folded card builds no body at all: a long transcript does not draw hidden diffs.
  const folded = render('apply_patch', { complete: true });
  assert.match(
    folded,
    /<div class="tool-card-body" inert="">[^<]*<div class="tool-card-body-inner"><\/div>/
  );
  clearExpandedToolCalls();
});

test("the card's motion and the code that times it agree", () => {
  // A card that left the transcript is held exactly as long as its fade.
  assert.match(toolCardsCss, new RegExp(`animation: tool-card-out ${TOOL_CARD_EXIT_MS}ms`));
  // A folded body keeps its content until the fold is done.
  const body = toolCardsCss.slice(
    toolCardsCss.indexOf('.tool-card-body {'),
    toolCardsCss.indexOf('.tool-card-body[data-open')
  );
  assert.match(body, new RegExp(`grid-template-rows ${TOOL_CARD_BODY_MS}ms`));
  // Nothing animates on a reload, a re-render or a scroll: only the live card does.
  assert.equal(toolCardsCss.split('animation: tool-card-in').length - 1, 1);
  assert.match(toolCardsCss, /\.tool-card\[data-live='true'\] \{\s*animation: tool-card-in/);
});

test('reduced motion turns every part of the card off', () => {
  const reduced = toolCardsCss.slice(
    toolCardsCss.indexOf('@media (prefers-reduced-motion: reduce)')
  );
  for (const selector of [
    ".tool-card[data-live='true']",
    '.tool-status',
    '.tool-card-pane',
    '.tool-card-body-content',
    '.codemode-call',
    '.tool-card-exit'
  ]) {
    assert.ok(reduced.includes(selector), `${selector} keeps its motion off`);
  }
});
