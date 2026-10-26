import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  PROVIDER_ORDER_STORAGE_KEY,
  moveProviderOrder,
  orderByProviderPreference,
  readProviderOrder,
  writeProviderOrder
} = await jiti.import('./provider-order.ts');

function memoryStorage(initial) {
  const values = new Map(initial ? [[PROVIDER_ORDER_STORAGE_KEY, initial]] : []);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values
  };
}

test('the provider order round-trips and drops malformed or duplicate ids', () => {
  const storage = memoryStorage();
  writeProviderOrder(['openai-codex', 'zai-coding-cn'], storage);
  assert.equal(storage.values.get(PROVIDER_ORDER_STORAGE_KEY), '["openai-codex","zai-coding-cn"]');
  assert.deepEqual(readProviderOrder(storage), ['openai-codex', 'zai-coding-cn']);

  assert.deepEqual(readProviderOrder(memoryStorage('not json')), []);
  assert.deepEqual(readProviderOrder(memoryStorage('{"a":1}')), []);
  assert.deepEqual(readProviderOrder(memoryStorage('["a",1,"","a","b"]')), ['a', 'b']);
  assert.deepEqual(readProviderOrder(null), []);
});

test('a storage failure leaves the list usable instead of throwing', () => {
  const throwing = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    }
  };
  assert.deepEqual(readProviderOrder(throwing), []);
  assert.doesNotThrow(() => writeProviderOrder(['a'], throwing));
});

test('arranged providers come first, unknown ones keep their incoming order after them', () => {
  const providers = ['a', 'b', 'c', 'b'];
  assert.deepEqual(
    orderByProviderPreference(providers, (id) => id, ['b', 'a']),
    ['b', 'b', 'a', 'c']
  );
  // With no preference the list is untouched.
  assert.deepEqual(
    orderByProviderPreference(providers, (id) => id, []),
    providers
  );
});

test('moving a provider past a visible neighbour leaves unlisted providers after the list', () => {
  assert.deepEqual(moveProviderOrder(['a', 'b', 'c'], ['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(moveProviderOrder(['a', 'hidden', 'b'], ['a', 'b'], 'b', -1), [
    'b',
    'a',
    'hidden'
  ]);
  assert.deepEqual(moveProviderOrder(['a', 'b', 'c'], ['b', 'c'], 'c', -1), ['c', 'b', 'a']);
});

test('a provider the saved order has never seen joins next to its arranged neighbour', () => {
  assert.deepEqual(moveProviderOrder(['a'], ['a', 'new'], 'new', -1), ['new', 'a']);
  assert.deepEqual(moveProviderOrder([], ['x', 'y'], 'y', -1), ['y', 'x']);
});

test('an arrow that cannot move changes nothing', () => {
  const order = ['a', 'b'];
  assert.deepEqual(moveProviderOrder(order, ['a', 'b'], 'a', -1), order);
  assert.deepEqual(moveProviderOrder(order, ['a', 'b'], 'b', 1), order);
  assert.deepEqual(moveProviderOrder(order, ['a', 'b'], 'missing', -1), order);
});
