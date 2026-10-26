import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { WORK_MODE_TYPE, appendWorkMode, readWorkMode, syncWorkMode, validateWorkMode } =
  await jiti.import('./work-mode.ts');

function customEntry(data) {
  return { type: 'custom', customType: WORK_MODE_TYPE, data };
}

function planEntry() {
  return customEntry({ version: 1, mode: 'plan' });
}

function clearedEntry() {
  return customEntry({ version: 1, mode: null });
}

function fakeManager(entries = []) {
  return {
    entries,
    appendCustomEntry(customType, data) {
      entries.push({ type: 'custom', customType, data });
    }
  };
}

test('the newest work-mode entry wins and a cleared entry retracts an earlier one', () => {
  assert.equal(readWorkMode([]), undefined);
  assert.equal(readWorkMode([planEntry()]), 'plan');
  assert.equal(readWorkMode([planEntry(), clearedEntry()]), undefined);
  // Append-only logs keep the old entry; only the newest valid one counts.
  assert.equal(readWorkMode([clearedEntry(), planEntry()]), 'plan');
});

test('unreadable and unrelated entries are skipped, not treated as cleared', () => {
  const unrelated = { type: 'custom', customType: 'pi-web:tool-selection', data: { version: 1 } };
  assert.equal(readWorkMode([unrelated, planEntry()]), 'plan');
  for (const data of [
    null,
    'plan',
    { version: 2, mode: 'plan' },
    { version: 1, mode: 'unknown' },
    { version: 1, mode: 42 }
  ]) {
    assert.equal(readWorkMode([customEntry(data), planEntry()]), 'plan', JSON.stringify(data));
  }
});

test('appending writes a versioned entry, with null for no mode', () => {
  const manager = fakeManager();
  appendWorkMode(manager, 'plan');
  assert.deepEqual(manager.entries, [customEntry({ version: 1, mode: 'plan' })]);

  appendWorkMode(manager, undefined);
  assert.deepEqual(manager.entries.at(-1), clearedEntry());
  assert.equal(readWorkMode(manager.entries), undefined);
});

test('syncing only appends when the stored mode differs', () => {
  const manager = fakeManager();
  syncWorkMode(manager, manager.entries, undefined);
  assert.deepEqual(manager.entries, []);

  syncWorkMode(manager, manager.entries, 'plan');
  assert.equal(manager.entries.length, 1);
  syncWorkMode(manager, manager.entries, 'plan');
  assert.equal(manager.entries.length, 1);

  syncWorkMode(manager, manager.entries, undefined);
  assert.equal(manager.entries.length, 2);
  assert.equal(readWorkMode(manager.entries), undefined);
});

test('validates the API value: absent, null, or plan', () => {
  assert.equal(validateWorkMode(undefined), undefined);
  assert.equal(validateWorkMode(null), undefined);
  assert.equal(validateWorkMode('plan'), 'plan');
  assert.throws(() => validateWorkMode('read-only'), /mode must be/);
  assert.throws(() => validateWorkMode(1), /mode must be/);
});
