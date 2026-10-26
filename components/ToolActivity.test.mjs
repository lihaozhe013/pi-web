import assert from 'node:assert/strict';
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

test('an executing call opens its card, with live output for a shell', () => {
  clearExpandedToolCalls();
  for (const name of ['bash', 'powershell', 'exec_command']) {
    const started = render(name, { running: true });
    assert.match(started, /aria-expanded="true"/, name);
    assert.match(started, /aria-busy="true"/, name);
    assert.match(started, /class="shell-running" role="status"/, name);
    // The command sits above the running status; the output follows it.
    assert.ok(started.indexOf('file-body') < started.indexOf('class="shell-running"'), name);

    const partial = render(name, { partial: true });
    assert.match(partial, /data-state="running"/, name);
    assert.ok(partial.indexOf('result-body') < partial.indexOf('class="shell-running"'), name);
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
  assert.match(render('bash', { running: true }), /aria-expanded="false"/);
  clearExpandedToolCalls();
});

test('a finished card follows its lifecycle default', () => {
  clearExpandedToolCalls();
  for (const name of ['write', 'edit']) {
    assert.match(render(name, { complete: true }), /aria-expanded="true"/);
    assert.match(render(name, { complete: true, error: true }), /aria-expanded="true"/);
  }
  assert.match(render('apply_patch', { complete: true }), /aria-expanded="false"/);
  // Only a failed shell keeps a card; a successful one leaves none.
  assert.equal(render('bash', { complete: true }), '');
  const failed = render('bash', { complete: true, error: true });
  assert.match(failed, /aria-expanded="false"/);
  assert.match(failed, /Failed/);
  assert.equal(render('read', { complete: true }), '');
});

test('an explicit choice still wins on a retained card', () => {
  clearExpandedToolCalls();
  setToolCallExpanded('tool-test', false);
  assert.match(render('write', { complete: true }), /aria-expanded="false"/);
  assert.match(render('bash', { complete: true, error: true }), /aria-expanded="false"/);
  clearExpandedToolCalls();
  setToolCallExpanded('tool-test', true);
  assert.match(render('bash', { complete: true, error: true }), /aria-expanded="true"/);
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
