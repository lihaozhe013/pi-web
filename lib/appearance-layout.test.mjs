import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { getRowOffsets } = await jiti.import('./session-tree.ts');
const { readFontSize } = await jiti.import('./font-preferences.ts');

test('UI font validation accepts finite sizes and limits the scale', () => {
  for (const value of [null, undefined, '', '   ', 'bad', Infinity])
    assert.equal(readFontSize('ui', value), 14);
  assert.equal(readFontSize('mono', undefined), 15);
  assert.equal(readFontSize('ui', '18'), 18);
  assert.equal(readFontSize('ui', 18.7), 19);
  assert.equal(readFontSize('mono', 100), 24);
  assert.equal(readFontSize('ui', -1), 12);
});

test('larger UI fonts grow virtual sidebar rows without growing section spacers', () => {
  const rows = [{ kind: 'session' }, { kind: 'spacer' }, { kind: 'group' }];
  assert.deepEqual(getRowOffsets(rows, 'desktop'), [0, 28, 36, 64]);
  assert.deepEqual(getRowOffsets(rows, 'desktop', 15), [0, 43, 51, 94]);
  assert.deepEqual(getRowOffsets(rows, 'mobile', 15), [0, 59, 67, 126]);
  assert.deepEqual(getRowOffsets(rows, 'desktop', NaN), [0, 28, 36, 64]);
});
