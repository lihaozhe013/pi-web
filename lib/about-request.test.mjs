import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { SHOW_ABOUT_EVENT, listenForShowAbout } = await jiti.import('./about-request.ts');

/** A stand-in for `window`: records what was subscribed and lets tests fire it. */
function target() {
  const calls = { added: [], removed: [] };
  return {
    calls,
    addEventListener(type, listener) {
      calls.added.push([type, listener]);
    },
    removeEventListener(type, listener) {
      calls.removed.push([type, listener]);
    },
    fire() {
      for (const [, listener] of calls.added) listener();
    }
  };
}

test('the shell request opens About, and stops when unsubscribed', () => {
  const window = target();
  let shown = 0;
  const off = listenForShowAbout(window, () => {
    shown += 1;
  });

  assert.equal(window.calls.added.length, 1);
  const [type, listener] = window.calls.added[0];
  assert.equal(type, SHOW_ABOUT_EVENT);
  window.fire();
  assert.equal(shown, 1);

  off();
  assert.deepEqual(window.calls.removed, [[type, listener]]);
});

test("the desktop shell dispatches this event, so the menu's About reaches the page", async () => {
  const rust = await readFile(new URL('../src-tauri/src/menu.rs', import.meta.url), 'utf8');
  assert.ok(
    rust.includes(`CustomEvent('${SHOW_ABOUT_EVENT}')`),
    `${SHOW_ABOUT_EVENT} is the event src-tauri/src/menu.rs dispatches`
  );
});
