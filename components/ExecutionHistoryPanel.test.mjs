import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: 'automatic' },
  tsconfigPaths: true
});
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { ExecutionHistoryPanel } = await jiti.import('./ExecutionHistoryPanel.tsx');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');

function render(entries, sessionId, historyOpen = true) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ExecutionHistoryPanel, {
        entries,
        sessionId,
        historyOpen,
        onHistoryOpenChange: () => {}
      })
    )
  );
}

function textOf(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'");
}

const base = {
  kind: 'shell',
  toolName: 'bash',
  command: 'bun test',
  preview: 'bun test',
  output: '',
  status: 'success'
};

test('an empty run history points at what will fill it', () => {
  const text = textOf(render([]));
  assert.match(text, /No active runs/);
  assert.match(text, /No completed runs yet/);
});

test('newest runs lead, a running one opens itself, a success waits folded', () => {
  const html = render([
    { ...base, id: 'old', output: 'old output' },
    {
      ...base,
      id: 'live',
      command: 'sleep 5',
      preview: 'sleep 5',
      status: 'running',
      output: 'tick'
    }
  ]);
  const text = textOf(html);

  assert.ok(html.indexOf('sleep 5') < html.indexOf('bun test'));
  assert.ok(html.indexOf('tick') > html.indexOf('sleep 5'), 'the running output is open');
  assert.doesNotMatch(text, /old output/);
  assert.match(text, /Active1/);
  assert.match(text, /History1/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /class="tool-card-body" data-open="true"/);
  assert.doesNotMatch(html, /data-live="true"/, 'opening the panel does not replay old runs');
});

test('history can be collapsed without removing its entries', () => {
  const html = render([{ ...base, id: 'old' }], undefined, false);
  assert.match(html, /data-history-open="false"/);
  assert.match(
    html,
    /class="run-history-toggle" aria-expanded="false" aria-controls="runs-history-content"/
  );
  assert.match(html, /id="runs-history-content"[^>]*aria-hidden="true" inert=""/);
  assert.match(html, /data-run-id="old"/);
});

test('a historical failure stays folded', () => {
  const html = render([{ ...base, id: 'failed', status: 'error', output: 'failure detail' }]);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /class="tool-card-body" aria-hidden="true" inert=""/);
  assert.doesNotMatch(html, /failure detail/);
});

test('a recently failed codemode run opens its calls, script and error output', () => {
  const calls = Array.from({ length: 23 }, (_, index) => ({
    id: `c/${index + 1}`,
    name: index === 22 ? 'bash' : 'read',
    args: `{"path":"file-${index + 1}"}`,
    status: index === 22 ? 'error' : 'ok',
    durationMs: 1_500,
    ...(index === 22 ? { error: 'exit code 2' } : {})
  }));
  calls.push(
    { id: 'c/24', name: 'models.classify', args: '', status: 'ok', cost: 0.004 },
    { id: 'c/25', name: 'models.classify', args: '', status: 'ok', cost: 0.006 }
  );
  const html = render([
    {
      ...base,
      id: 'cm',
      kind: 'codemode',
      toolName: 'codemode',
      command: 'const files = await tools.ls({ path: "." });',
      preview: 'const files = await tools.ls({ path: "." });',
      status: 'error',
      active: true,
      script: 'const files = await tools.ls({ path: "." });',
      calls,
      omittedCalls: 0,
      output: 'Script error:\nError: exit code 2'
    }
  ]);
  const text = textOf(html);

  assert.match(html, /<details class="run-history-script"><summary>View script<\/summary>/);
  assert.ok(html.indexOf('codemode-call"') < html.indexOf('run-history-script'));
  assert.match(text, /Tool calls/);
  assert.match(text, /Show 5 earlier calls/);
  assert.doesNotMatch(text, /"file-5"/);
  assert.match(text, /"file-6"/);
  assert.match(text, /exit code 2/);
  assert.match(text, /Model calls: \$0\.01/);
  assert.match(text, /Script error:\nError: exit code 2/);
  assert.doesNotMatch(text, /Wall time/);
});

test('the output keeps its tail behind a button, and a user run is named', () => {
  const output = Array.from({ length: 45 }, (_, index) => `line ${index + 1}`).join('\n');
  const html = render(
    [
      {
        ...base,
        id: 'user',
        command: '!make check',
        preview: 'make check',
        output,
        userInitiated: true,
        status: 'error',
        active: true,
        truncated: true,
        fullOutputPath: '/tmp/pi-bash-abc.log'
      }
    ],
    'session-1'
  );
  const text = textOf(html);

  assert.match(text, /You/);
  assert.match(text, /Show 5 earlier lines/);
  assert.doesNotMatch(text, /line 1\b/);
  assert.match(text, /line 45/);
  assert.match(html, /data-error="true"/);
  assert.match(text, /Failed/);
  assert.match(text, /The stored result was truncated/);
  assert.match(text, /Show full output/);
  assert.match(text, /Download full output/);
  assert.match(html, /\/api\/agent\/session-1\/bash-output\?path=%2Ftmp%2Fpi-bash-abc\.log/);
});
