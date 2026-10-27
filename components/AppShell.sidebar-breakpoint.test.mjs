import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { Script, createContext } from 'node:vm';
import { astNodes, declarationName, nodeText, parseSource } from '../lib/source-testing.mjs';

const source = await readFile(new URL('./AppShell.tsx', import.meta.url), 'utf8');
const nodes = astNodes(parseSource(source, 'AppShell.tsx'));
function script(text) {
  return new Script(stripTypeScriptTypes(text));
}
function setup(collapsed = false) {
  const preference = nodes.find(
    (node) =>
      node.type === 'VariableDeclarator' && declarationName(node) === 'desktopSidebarOpenRef'
  );
  assert.ok(preference, 'desktop preference must be independent of drawer state');
  const effect = nodes.find(
    (node) =>
      node.type === 'CallExpression' &&
      nodeText(source, node.callee) === 'useEffect' &&
      node.arguments[1] &&
      nodeText(source, node.arguments[1]) === '[isMobile]' &&
      nodeText(source, node.arguments[0]).includes('setSidebarOpen')
  );
  assert.ok(effect, 'the sidebar breakpoint effect not found');
  const toggle = nodes.find(
    (node) => node.type === 'VariableDeclarator' && declarationName(node) === 'handleSidebarToggle'
  );
  assert.ok(toggle, 'handleSidebarToggle not found');
  const context = createContext({
    initialNavigation: { sidebarCollapsed: collapsed },
    isMobile: false,
    sidebarOpen: !collapsed,
    useRef: (current) => ({ current }),
    setActiveTopPanel() {},
    setMobileToolbarMoreOpen() {}
  });
  context.desktopSidebarOpenRef = script(nodeText(source, preference.init)).runInContext(context);
  context.setSidebarOpen = (value) => {
    context.sidebarOpen = typeof value === 'function' ? value(context.sidebarOpen) : value;
  };
  const runEffect = () =>
    script(`(${nodeText(source, effect.arguments[0])})()`).runInContext(context);
  const runToggle = () =>
    script(`(${nodeText(source, toggle.init.arguments[0])})()`).runInContext(context);
  return {
    context,
    runToggle,
    resize: (mobile) => {
      context.isMobile = mobile;
      runEffect();
    }
  };
}

test('closing a mobile drawer restores the previously open desktop sidebar', () => {
  const state = setup();
  state.resize(true);
  assert.equal(state.context.sidebarOpen, false);
  state.runToggle();
  assert.equal(state.context.sidebarOpen, true);
  state.runToggle();
  assert.equal(state.context.sidebarOpen, false);
  state.resize(false);
  assert.equal(state.context.sidebarOpen, true);
});

test('opening a mobile drawer does not reopen an explicitly collapsed desktop sidebar', () => {
  const state = setup();
  state.runToggle();
  assert.equal(state.context.sidebarOpen, false);
  state.resize(true);
  state.runToggle();
  state.resize(false);
  assert.equal(state.context.sidebarOpen, false);
  state.runToggle();
  state.resize(true);
  state.resize(false);
  assert.equal(state.context.sidebarOpen, true);
});

test('URL sidebar collapse survives hydration and repeated breakpoint crossings', () => {
  const state = setup(true);
  state.resize(false);
  assert.equal(state.context.sidebarOpen, false);
  state.resize(true);
  state.runToggle();
  state.resize(false);
  assert.equal(state.context.sidebarOpen, false);
  state.runToggle();
  state.resize(true);
  state.resize(false);
  assert.equal(state.context.sidebarOpen, true);
});
