import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';

// The hook runs against a stand-in for React's hooks (one component, effects
// after each render) and mocked timers, so a fade can be played out to its end
// without a browser — the same fixture the sidebar's motion test uses.
const shimPath = fileURLToPath(new URL('./__fixtures__/react-hook-shim.mjs', import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(pathToFileURL(shimPath).href);
const {
  TOOL_CARD_BODY_MS,
  TOOL_CARD_EXIT_MS,
  holdExitingItems,
  useBodyContent,
  useExitHold,
  useExitingItems
} = await jiti.import('./useToolCardMotion.ts');

function withMotion(reduce) {
  globalThis.window = {
    matchMedia: (query) => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)' })
  };
}

const card = (id) => ({ id });

test.beforeEach(() => {
  withMotion(false);
  mock.timers.enable({ apis: ['setTimeout'] });
});

test.afterEach(() => {
  mock.timers.reset();
  delete globalThis.window;
});

test('the list keeps its order; a card that left is held where it stood', () => {
  const previous = [card('a'), card('b'), card('c')];
  assert.deepEqual(
    holdExitingItems([card('a'), card('c')], previous, (item) => item.id),
    [
      { item: card('a'), exiting: false },
      { item: card('b'), exiting: true },
      { item: card('c'), exiting: false }
    ]
  );
  // A new card goes last, where the transcript appends it.
  assert.deepEqual(
    holdExitingItems([card('a'), card('d')], previous, (item) => item.id),
    [
      { item: card('a'), exiting: false },
      { item: card('b'), exiting: true },
      { item: card('c'), exiting: true },
      { item: card('d'), exiting: false }
    ]
  );
  // Nothing left: the list as it is.
  assert.deepEqual(
    holdExitingItems(previous, previous, (item) => item.id),
    previous.map((item) => ({ item, exiting: false }))
  );
});

test('a card that leaves the list fades, then is gone', () => {
  const view = renderHook(({ items }) => useExitingItems(items, (item) => item.id), {
    items: [card('a'), card('b')]
  });
  assert.deepEqual(
    view.result.map((entry) => [entry.item.id, entry.exiting]),
    [
      ['a', false],
      ['b', false]
    ]
  );
  view.rerender({ items: [card('a')] });
  assert.deepEqual(
    view.result.map((entry) => [entry.item.id, entry.exiting]),
    [
      ['a', false],
      ['b', true]
    ],
    'the card that left stays for its fade'
  );
  mock.timers.tick(TOOL_CARD_EXIT_MS - 1);
  view.flush();
  assert.equal(view.result.length, 2, 'not gone before its fade ends');
  mock.timers.tick(1);
  view.flush();
  assert.deepEqual(
    view.result.map((entry) => [entry.item.id, entry.exiting]),
    [['a', false]],
    'gone once it faded'
  );
  view.unmount();
});

test('a card that comes back cancels its own fade', () => {
  const view = renderHook(({ items }) => useExitingItems(items, (item) => item.id), {
    items: [card('a')]
  });
  view.rerender({ items: [] });
  assert.deepEqual(
    view.result.map((entry) => [entry.item.id, entry.exiting]),
    [['a', true]]
  );
  view.rerender({ items: [card('a')] });
  assert.deepEqual(
    view.result.map((entry) => [entry.item.id, entry.exiting]),
    [['a', false]]
  );
  mock.timers.tick(TOOL_CARD_EXIT_MS);
  view.flush();
  assert.deepEqual(
    view.result.map((entry) => [entry.item.id, entry.exiting]),
    [['a', false]],
    'the cancelled fade cannot drop it later'
  );
  view.unmount();
});

test('under prefers-reduced-motion nothing is held: the card goes at once', () => {
  withMotion(true);
  const view = renderHook(({ items }) => useExitingItems(items, (item) => item.id), {
    items: [card('a')]
  });
  view.rerender({ items: [] });
  assert.deepEqual(view.result, []);
  view.unmount();
  withMotion(false);
});

test('one element that shows and goes: open, fading, gone', () => {
  const view = renderHook(({ active }) => useExitHold(active), { active: false });
  assert.deepEqual(view.result, { open: false, exiting: false }, 'closed on mount');
  view.rerender({ active: true });
  assert.deepEqual(view.result, { open: true, exiting: false });
  view.rerender({ active: false });
  assert.deepEqual(view.result, { open: true, exiting: true }, 'held for its fade');
  mock.timers.tick(TOOL_CARD_EXIT_MS);
  view.flush();
  assert.deepEqual(view.result, { open: false, exiting: false });
  view.unmount();
});

test('a body keeps its content while it folds shut, then lets it go', () => {
  const view = renderHook(({ open }) => useBodyContent(open), { open: false });
  assert.equal(view.result, false, 'a collapsed card builds nothing');
  view.rerender({ open: true });
  assert.equal(view.result, true);
  view.rerender({ open: false });
  assert.equal(view.result, true, 'still there while it folds');
  mock.timers.tick(TOOL_CARD_BODY_MS);
  view.flush();
  assert.equal(view.result, false);
  view.unmount();
});

test('under prefers-reduced-motion a body folds at once', () => {
  withMotion(true);
  const view = renderHook(({ open }) => useBodyContent(open), { open: true });
  view.rerender({ open: false });
  view.flush();
  assert.equal(view.result, false);
  view.unmount();
  withMotion(false);
});
