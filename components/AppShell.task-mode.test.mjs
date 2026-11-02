import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./AppShell.tsx', import.meta.url), 'utf8');

test('the page carries one switch, in the toolbar both views share', () => {
  assert.equal(
    (source.match(/<WorkspaceSwitch /g) ?? []).length,
    1,
    'one control, so the choice never moves between views'
  );
  assert.match(source, /<WorkspaceSwitch mode=\{taskMode \? 'tasks' : 'chat'\} \/>/);
  assert.doesNotMatch(
    source,
    /if \(taskMode\) \{\n\s*return \(/,
    'the task view is not a second page'
  );
});

test('only the center of the page changes between chat and tasks', () => {
  assert.match(source, /\{taskMode \? \(\n\s*<div className="workspace-task-view">/);
  assert.match(
    source,
    /<div\s+ref=\{runsPanelResizer\.panelRef\}[\s\S]*?\n\s*\{sidebarContent\}/,
    'the sidebar is rendered by the shell, not by one view'
  );
  assert.match(source, /<TaskWorkspace/);
});

test('the task view owns its URL instead of restoring a remembered session', () => {
  const restore =
    /useLayoutEffect\(\(\) => \{\n(?:.*\n)*?\s*if \(taskMode\) return;\n(?:.*\n)*?\s*const next = withTabOpen\(/.test(
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

test('the task queue docks in the same right-hand slot as Runs', () => {
  assert.match(source, /queuePanelDocked=\{taskQueuePanelDocked\}/);
  assert.match(source, /panelId="task-queue-panel"/);
  assert.match(source, /data-resize-handle="task-queue-panel"/);
  assert.match(source, /contentClassName="task-queue-panel-content"/);
  assert.match(source, /toggleSelector='\[data-task-queue-toggle="true"\]'/);
  assert.match(source, /\{taskQueuePanelOpen && \(/, 'the panel renders only while open');
});

test('the task header does not duplicate the switch or the Settings entry', () => {
  assert.doesNotMatch(source, /onOpenChat/);
  assert.doesNotMatch(source, /tasks\.backToChat/);
  assert.doesNotMatch(source, /moreControls/);
  assert.doesNotMatch(source, /task-mode-settings/, 'Settings stays in the sidebar footer');
});
