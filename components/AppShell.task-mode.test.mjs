import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./AppShell.tsx', import.meta.url), 'utf8');

test('both views carry the switch in their page header', () => {
  assert.match(source, /<WorkspaceSwitch mode="chat" \/>/);
  assert.match(source, /<WorkspaceSwitch mode="tasks" \/>/);
});

test('the task view owns its URL instead of restoring a remembered session', () => {
  const restore = /useLayoutEffect\(\(\) => \{\n(?:.*\n)*?\s*if \(taskMode\) return;\n(?:.*\n)*?\s*const next = withTabOpen\(/.test(
    source
  );
  assert.ok(restore, 'the tab-memory restore must stop before replacing ?mode=tasks');
});

test('the Runs panel and its session actions belong to the chat view', () => {
  assert.match(source, /\{runsPanelOpen && !taskMode && \(/, 'the panel renders only in chat');
  assert.match(source, /\{sessionPanelActions\}/, 'the panel carries the session actions');
  assert.match(
    source,
    /<div className="session-panel-stack">/,
    'the actions and the runs share one column'
  );
});

test('the task header does not duplicate the switch with a back button', () => {
  assert.doesNotMatch(source, /onOpenChat/);
  assert.doesNotMatch(source, /tasks\.backToChat/);
  assert.doesNotMatch(source, /moreControls/);
});
