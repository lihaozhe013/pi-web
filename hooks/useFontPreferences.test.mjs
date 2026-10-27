import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import * as fonts from '../lib/font-preferences.ts';

// The hook runs against a stand-in for React's useSyncExternalStore that reads
// the snapshot eagerly, so the store can be driven without mounting React.
const reactShim = fileURLToPath(
  new URL('./__fixtures__/react-external-store.mjs', import.meta.url)
);

async function loadStore() {
  // The hook keeps its preference state at module level, so every fixture
  // evaluates a fresh copy of the module.
  const jiti = createJiti(import.meta.url, {
    tsconfigPaths: true,
    alias: { react: reactShim },
    moduleCache: false
  });
  return jiti.import('./useFontPreferences.ts');
}

async function fixture({ initial = {}, blocked = false, server = false } = {}) {
  const stored = new Map(Object.entries(initial));
  const applied = new Map();
  const events = new Map();
  const storage = {
    getItem(key) {
      if (blocked) throw new Error('blocked');
      return stored.get(key) ?? null;
    },
    setItem(key, value) {
      if (blocked) throw new Error('blocked');
      stored.set(key, value);
    },
    removeItem(key) {
      if (blocked) throw new Error('blocked');
      stored.delete(key);
    }
  };
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  if (server) {
    delete globalThis.window;
    delete globalThis.document;
  } else {
    globalThis.window = {
      localStorage: storage,
      addEventListener(type, listener) {
        assert.equal(events.has(type), false);
        events.set(type, listener);
      },
      removeEventListener(type, listener) {
        assert.equal(events.get(type), listener);
        events.delete(type);
      }
    };
    globalThis.document = {
      documentElement: {
        style: {
          setProperty(key, value) {
            applied.set(key, value);
          },
          removeProperty(key) {
            applied.delete(key);
          }
        }
      }
    };
  }
  const store = await loadStore();
  return {
    ...store,
    stored,
    applied,
    events,
    restore() {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    }
  };
}

test('server rendering uses stable defaults without touching browser APIs', async () => {
  const store = await fixture({ server: true });
  assert.equal(store.useFontPreferences().ui, '');
  assert.equal(store.useFontPreferences().mono, '');
  assert.equal(store.useFontPreferences().uiWeight, 400);
  assert.equal(store.useFontPreferences().monoWeight, 400);
  store.restore();
});

test('mounting restores both fonts without opening Settings', async () => {
  const store = await fixture({
    initial: { [fonts.FONT_STORAGE_KEYS.ui]: 'Georgia', [fonts.FONT_STORAGE_KEYS.mono]: 'Menlo' }
  });
  assert.equal(store.useFontPreferences().ui, 'Georgia');
  assert.equal(store.useFontPreferences().mono, 'Menlo');
  assert.equal(store.applied.get('--font-ui'), '"Georgia", var(--font-ui-default)');
  assert.equal(store.applied.get('--font-mono'), '"Menlo", var(--font-mono-default)');
  store.restore();
});

test('weight edits preserve font names, notify consumers and reset one font atomically', async () => {
  const store = await fixture({
    initial: {
      [fonts.FONT_STORAGE_KEYS.ui]: 'Georgia',
      [fonts.FONT_STORAGE_KEYS.mono]: 'Menlo',
      [fonts.FONT_STORAGE_KEYS.monoWeight]: '600',
      'pi-chat-content-font-size': '18'
    }
  });
  let notifications = 0;
  const stop = store.subscribeFontPreferences(() => notifications++);
  assert.equal(store.useFontPreferences().uiWeight, 400, 'older preferences retain Regular');
  assert.equal(store.useFontPreferences().monoWeight, 600);
  assert.equal(store.applied.get('--font-mono-weight'), '600');
  store.setFontWeight('ui', 500);
  assert.equal(store.useFontPreferences().ui, 'Georgia');
  assert.equal(store.applied.get('--font-ui-weight'), '500');
  assert.equal(store.stored.get(fonts.FONT_STORAGE_KEYS.uiWeight), '500');
  store.setFontPreference('ui', 'Arial');
  assert.equal(store.useFontPreferences().uiWeight, 500, 'a new family keeps the chosen weight');
  store.setFontWeight('ui', 500);
  assert.equal(notifications, 2, 'an unchanged weight does not notify');
  store.resetFontPreference('ui');
  assert.equal(notifications, 3, 'resetting family and weight is one update');
  assert.equal(store.useFontPreferences().ui, '');
  assert.equal(store.useFontPreferences().uiWeight, 400);
  assert.equal(store.applied.has('--font-ui'), false);
  assert.equal(store.applied.has('--font-ui-weight'), false);
  assert.equal(store.stored.has(fonts.FONT_STORAGE_KEYS.uiWeight), false);
  assert.equal(store.useFontPreferences().mono, 'Menlo');
  assert.equal(store.useFontPreferences().monoWeight, 600);
  assert.equal(store.stored.get('pi-chat-content-font-size'), '18');
  store.setFontWeight('mono', 400);
  assert.equal(store.applied.has('--font-mono-weight'), false);
  assert.equal(store.stored.has(fonts.FONT_STORAGE_KEYS.monoWeight), false);
  assert.equal(store.useFontPreferences().mono, 'Menlo');
  stop();
  store.restore();
});

test('edits notify all consumers, preserve typed spaces and reset each font independently', async () => {
  const store = await fixture();
  let notifications = 0;
  const stop = store.subscribeFontPreferences(() => notifications++);
  let terminalNotifications = 0;
  const stopTerminal = store.subscribeFontPreferences(() => terminalNotifications++);
  store.setFontPreference('ui', 'Times New ');
  store.setFontPreference('mono', 'Menlo');
  assert.equal(store.useFontPreferences().ui, 'Times New ');
  assert.equal(store.stored.get(fonts.FONT_STORAGE_KEYS.ui), 'Times New ');
  assert.equal(notifications, 2);
  assert.equal(terminalNotifications, 2);
  store.setFontPreference('mono', 'Menlo');
  assert.equal(notifications, 2, 'unchanged values do not notify');
  store.setFontPreference('ui', '');
  assert.equal(store.applied.has('--font-ui'), false);
  assert.equal(store.stored.has(fonts.FONT_STORAGE_KEYS.ui), false);
  assert.equal(store.useFontPreferences().mono, 'Menlo');
  assert.equal(store.applied.get('--font-mono'), '"Menlo", var(--font-mono-default)');
  stop();
  assert.equal(store.events.has('storage'), true);
  stopTerminal();
  assert.equal(store.events.size, 0);
  store.restore();
});

test('storage changes in another tab, including clear, update the current page', async () => {
  const store = await fixture();
  let notifications = 0;
  const stop = store.subscribeFontPreferences(() => notifications++);
  store.stored.set(fonts.FONT_STORAGE_KEYS.ui, 'Arial');
  store.events.get('storage')({ key: 'unrelated' });
  assert.equal(notifications, 0);
  store.events.get('storage')({ key: fonts.FONT_STORAGE_KEYS.ui });
  assert.equal(store.useFontPreferences().ui, 'Arial');
  assert.equal(store.applied.get('--font-ui'), '"Arial", var(--font-ui-default)');
  store.stored.set(fonts.FONT_STORAGE_KEYS.uiWeight, '500');
  store.events.get('storage')({ key: fonts.FONT_STORAGE_KEYS.uiWeight });
  assert.equal(store.useFontPreferences().uiWeight, 500);
  store.stored.clear();
  store.events.get('storage')({ key: null });
  assert.equal(store.useFontPreferences().ui, '');
  assert.equal(store.applied.size, 0);
  assert.equal(store.useFontPreferences().uiWeight, 400);
  assert.equal(notifications, 3);
  stop();
  store.restore();
});

test('three size domains are independent, bounded, persisted and reset separately', async () => {
  const store = await fixture({ initial: { 'pi-chat-content-font-size': '18' } });
  const stop = store.subscribeFontPreferences(() => {});
  assert.equal(store.useFontPreferences().uiSize, 15);
  assert.equal(store.useFontPreferences().monoSize, 12);
  store.setFontSize('ui', 20);
  store.setFontSize('mono', 22);
  assert.equal(store.applied.get('--font-ui-size'), '20px');
  assert.equal(store.applied.get('--font-mono-size'), '22px');
  assert.equal(store.stored.get('pi-chat-content-font-size'), '18');
  store.resetFontPreference('ui');
  assert.equal(store.applied.has('--font-ui-size'), false);
  assert.equal(store.useFontPreferences().monoSize, 22);
  assert.equal(store.stored.get('pi-mono-font-size'), '22');
  store.setFontSize('mono', 100);
  assert.equal(store.useFontPreferences().monoSize, 24);
  store.stored.set('pi-ui-font-size', '19');
  store.events.get('storage')({ key: 'pi-ui-font-size' });
  assert.equal(store.useFontPreferences().uiSize, 19);
  store.stored.clear();
  store.events.get('storage')({ key: null });
  assert.equal(store.useFontPreferences().uiSize, 15);
  assert.equal(store.useFontPreferences().monoSize, 12);
  assert.equal(store.applied.size, 0);
  stop();
  store.restore();
});

test('size restoration validates saved data and blocked storage stays editable', async () => {
  const restored = await fixture({
    initial: { 'pi-ui-font-size': '18', 'pi-mono-font-size': 'invalid' }
  });
  assert.equal(restored.useFontPreferences().uiSize, 18);
  assert.equal(restored.useFontPreferences().monoSize, 12);
  restored.restore();
  const blocked = await fixture({ blocked: true });
  blocked.setFontSize('ui', 19);
  blocked.setFontSize('mono', 21);
  assert.equal(blocked.applied.get('--font-ui-size'), '19px');
  assert.equal(blocked.applied.get('--font-mono-size'), '21px');
  blocked.resetFontPreference('mono');
  blocked.restore();
});

test('blocked storage and malformed saved values leave usable defaults and live editing', async () => {
  const invalid = await fixture({
    initial: {
      [fonts.FONT_STORAGE_KEYS.ui]: 'a'.repeat(fonts.FONT_FAMILY_MAX_LENGTH + 1),
      [fonts.FONT_STORAGE_KEYS.uiWeight]: 'Light',
      [fonts.FONT_STORAGE_KEYS.monoWeight]: '1000'
    }
  });
  assert.equal(invalid.useFontPreferences().ui, '');
  assert.equal(invalid.useFontPreferences().uiWeight, 400);
  assert.equal(invalid.useFontPreferences().monoWeight, 400);
  assert.equal(invalid.applied.size, 0);
  invalid.restore();
  const blocked = await fixture({ blocked: true });
  assert.equal(blocked.useFontPreferences().mono, '');
  blocked.setFontPreference('mono', 'monospace');
  assert.equal(blocked.useFontPreferences().mono, 'monospace');
  assert.equal(blocked.applied.get('--font-mono'), 'monospace, var(--font-mono-default)');
  blocked.setFontWeight('mono', 300);
  assert.equal(blocked.useFontPreferences().monoWeight, 300);
  blocked.resetFontPreference('mono');
  blocked.restore();
});
