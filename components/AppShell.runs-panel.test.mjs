import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  isRunsPanelOpen,
  RUNS_PANEL_DEFAULT_PREFERENCE,
  toggleRunsPanelPreference
} from '../lib/panel-layout.ts';
import { astNodes, declarationName, nodeText, parseSource } from '../lib/source-testing.mjs';

const source = await readFile(new URL('./AppShell.tsx', import.meta.url), 'utf8');
const nodes = astNodes(parseSource(source, 'AppShell.tsx'));

const docked = { overlay: false, settingsOpen: false };
const overlay = { overlay: true, settingsOpen: false };
const defaultOpen = (layout) => isRunsPanelOpen(RUNS_PANEL_DEFAULT_PREFERENCE, layout);

test('the Runs panel belongs to the default docked page, even before a command runs', () => {
  assert.equal(defaultOpen(docked), true);
});

test('a phone keeps the conversation visible instead of the overlay panel', () => {
  assert.equal(defaultOpen(overlay), false);
});

test('a user collapse is the only thing that keeps the docked panel closed', () => {
  const collapsed = toggleRunsPanelPreference(RUNS_PANEL_DEFAULT_PREFERENCE, {
    open: true,
    overlay: false
  });
  assert.deepEqual(collapsed, { collapsed: true, overlayRequested: false });
  assert.equal(isRunsPanelOpen(collapsed, docked), false);
  assert.equal(isRunsPanelOpen(collapsed, overlay), false);
});

test('the panel opens again only when the user asks for it', () => {
  const collapsed = { collapsed: true, overlayRequested: false };
  const opened = toggleRunsPanelPreference(collapsed, { open: false, overlay: false });
  assert.deepEqual(opened, { collapsed: false, overlayRequested: false });
  assert.equal(isRunsPanelOpen(opened, docked), true);
});

test('a panel the user opens where it overlays stays open there', () => {
  const opened = toggleRunsPanelPreference(RUNS_PANEL_DEFAULT_PREFERENCE, {
    open: false,
    overlay: true
  });
  assert.equal(opened.overlayRequested, true);
  assert.equal(isRunsPanelOpen(opened, overlay), true);
  assert.equal(isRunsPanelOpen(opened, docked), true);

  const closed = toggleRunsPanelPreference(opened, { open: true, overlay: true });
  assert.equal(closed.overlayRequested, false);
  assert.equal(isRunsPanelOpen(closed, overlay), false);
});

test('Settings hides the panel without collapsing it', () => {
  assert.equal(
    isRunsPanelOpen(RUNS_PANEL_DEFAULT_PREFERENCE, { overlay: false, settingsOpen: true }),
    false
  );
  assert.equal(defaultOpen(docked), true, 'closing Settings brings the default panel back');
});

test('AppShell derives the panel from the default preference and never from a run', () => {
  const preference = nodes.find(
    (node) =>
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'ArrayPattern' &&
      node.id.elements?.some((element) => element?.name === 'runsPanelPreference')
  );
  assert.ok(preference, 'the Runs preference state was not found');
  assert.match(
    nodeText(source, preference.init),
    /useState<RunsPanelPreference>\(\s*RUNS_PANEL_DEFAULT_PREFERENCE\s*\)/,
    'the panel must start from the default preference'
  );

  const open = nodes.find(
    (node) => node.type === 'VariableDeclarator' && declarationName(node) === 'runsPanelOpen'
  );
  assert.ok(open, 'the Runs visibility was not found');
  assert.match(
    nodeText(source, open.init),
    /isRunsPanelOpen\(runsPanelPreference/,
    'visibility must follow the preference and the layout'
  );

  const autoOpen = nodes.some(
    (node) =>
      node.type === 'CallExpression' &&
      ['useEffect', 'useLayoutEffect'].includes(nodeText(source, node.callee)) &&
      node.arguments[1] &&
      /runInProgress|sessionBusy/.test(nodeText(source, node.arguments[1]))
  );
  assert.equal(autoOpen, false, 'a running command must not reopen a collapsed panel');

  assert.ok(
    nodes.some(
      (node) =>
        node.type === 'JSXExpressionContainer' &&
        nodeText(source, node.expression).startsWith('!runsPanelOpen &&')
    ),
    'the edge toggle must appear only while the panel is closed'
  );
  assert.ok(
    nodes.some(
      (node) =>
        node.type === 'JSXExpressionContainer' &&
        nodeText(source, node.expression).startsWith('runsPanelOpen &&')
    ),
    'the panel must render while it is open'
  );
});
