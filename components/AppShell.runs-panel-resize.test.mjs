import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { astNodes, declarationName, nodeText, parseSource } from '../lib/source-testing.mjs';

// The Runs panel is the app's only docked right panel; these checks keep its
// resize wiring (the shared panel hook, its limits and the docked-only handle)
// from drifting away from the layout rules in lib/panel-layout.
const source = await readFile(new URL('./AppShell.tsx', import.meta.url), 'utf8');
const nodes = astNodes(parseSource(source, 'AppShell.tsx'));

test('the Runs panel resizes through the shared panel hook', () => {
  const resizer = nodes.find(
    (node) => node.type === 'VariableDeclarator' && declarationName(node) === 'runsPanelResizer'
  );
  assert.ok(resizer, 'runsPanelResizer was not found');
  assert.equal(nodeText(source, resizer.init.callee), 'useResizablePanel');
  const options = nodeText(source, resizer.init);
  assert.match(options, /cssVariable: '--runs-panel-width'/, 'the panel needs its own width');
  assert.match(options, /growthDirection: 'left'/, 'the panel grows towards the conversation');
  assert.match(options, /storageKey: 'pi-runs-panel-width'/, 'the size is remembered');
  assert.match(options, /minWidth: RIGHT_PANEL_MIN_WIDTH/);
  assert.match(options, /maxWidth: RIGHT_PANEL_MAX_WIDTH/);
  assert.match(
    options,
    /persistClamp: false/,
    'a window too small for the size must not overwrite the user choice'
  );

  const maxWidth = nodes.find(
    (node) =>
      node.type === 'VariableDeclarator' &&
      declarationName(node) === 'getResponsiveRunsPanelMaxWidth'
  );
  assert.ok(maxWidth, 'the responsive maximum was not found');
  assert.match(nodeText(source, maxWidth.init), /getRightPanelMaxWidth\(/);
});

test('the resize handle exists only while the panel is docked', () => {
  const handle = nodes.find(
    (node) =>
      node.type === 'JSXAttribute' &&
      node.name?.name === 'data-resize-handle' &&
      nodeText(source, node.value) === '"runs-panel"'
  );
  assert.ok(handle, 'the Runs panel handle was not found');

  const separator = nodes.find(
    (node) =>
      node.type === 'JSXAttribute' &&
      node.name?.name === 'aria-controls' &&
      nodeText(source, node.value) === '"session-information"'
  );
  assert.ok(separator, 'the handle must name the panel it resizes');

  const dockedOnly = nodes.find(
    (node) =>
      node.type === 'JSXExpressionContainer' &&
      nodeText(source, node.expression).startsWith('!informationPanelOverlay &&')
  );
  assert.ok(dockedOnly, 'an overlay panel fills the screen and has no handle');
});
