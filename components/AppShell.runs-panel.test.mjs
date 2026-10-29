import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { Script, createContext } from 'node:vm';
import { astNodes, nodeText, parseSource } from '../lib/source-testing.mjs';

const source = await readFile(new URL('./AppShell.tsx', import.meta.url), 'utf8');
const nodes = astNodes(parseSource(source, 'AppShell.tsx'));

const RUNS_EFFECT_DEPS = '[informationPanelOverlay, runInProgress, runSessionKey, sessionBusy]';

function runsEffect() {
  const effect = nodes.find(
    (node) =>
      node.type === 'CallExpression' &&
      nodeText(source, node.callee) === 'useEffect' &&
      node.arguments[1] &&
      nodeText(source, node.arguments[1]) === RUNS_EFFECT_DEPS
  );
  assert.ok(effect, 'the Runs auto-open effect was not found');
  return effect;
}

// Runs the real effect body in a sandbox: each call models one render commit.
function setup() {
  const state = {
    activeTopPanel: null,
    autoOpened: false,
    informationPanelOverlay: false,
    runInProgress: false,
    runSessionKey: 'session-a',
    sessionBusy: false
  };
  const context = createContext({
    autoOpenedRunsRef: { current: null },
    setTopPanelAutoOpened(value) {
      state.autoOpened = Boolean(value);
    },
    setActiveTopPanel(panel) {
      state.activeTopPanel = typeof panel === 'function' ? panel(state.activeTopPanel) : panel;
    }
  });
  const run = new Script(
    `(${stripTypeScriptTypes(nodeText(source, runsEffect().arguments[0]))})()`
  );
  return {
    state,
    commit(next) {
      Object.assign(state, next);
      for (const key of [
        'informationPanelOverlay',
        'runInProgress',
        'runSessionKey',
        'sessionBusy'
      ]) {
        context[key] = state[key];
      }
      run.runInContext(context);
      return state;
    }
  };
}

test('the first running command of a turn opens the Runs panel without taking focus', () => {
  const { state, commit } = setup();
  commit({ sessionBusy: true });
  assert.equal(
    state.activeTopPanel,
    null,
    'a conversation that has not run a command stays closed'
  );

  commit({ runInProgress: true });
  assert.equal(state.activeTopPanel, 'runs');
  assert.equal(state.autoOpened, true, 'an unrequested panel must not take focus');
});

test('closing the Runs panel during a turn keeps it closed for that turn', () => {
  const { state, commit } = setup();
  commit({ sessionBusy: true, runInProgress: true });
  assert.equal(state.activeTopPanel, 'runs');

  state.activeTopPanel = null;
  commit({ runInProgress: false });
  commit({ runInProgress: true });
  assert.equal(state.activeTopPanel, null, 'the next command in the same turn must not reopen it');
});

test('the next turn opens the Runs panel again', () => {
  const { state, commit } = setup();
  commit({ sessionBusy: true, runInProgress: true });
  state.activeTopPanel = null;

  commit({ sessionBusy: false, runInProgress: false });
  commit({ sessionBusy: true });
  commit({ runInProgress: true });
  assert.equal(state.activeTopPanel, 'runs');
});

test('switching to a conversation that is already running opens the Runs panel', () => {
  const { state, commit } = setup();
  commit({ sessionBusy: true, runInProgress: true });
  state.activeTopPanel = null;

  commit({ runSessionKey: 'session-b' });
  assert.equal(state.activeTopPanel, 'runs');
});

test('an overlaid panel stays closed while it would cover the conversation', () => {
  const { state, commit } = setup();
  commit({ informationPanelOverlay: true, sessionBusy: true, runInProgress: true });
  assert.equal(state.activeTopPanel, null);

  commit({ informationPanelOverlay: false });
  assert.equal(state.activeTopPanel, 'runs');
});
