import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { addAttachedFiles, attachedFileFromPath, composeMessageWithFiles } = await jiti.import(
  './attached-files.ts'
);

test('a chip names the file by its base name and keeps the relative path', () => {
  assert.deepEqual(attachedFileFromPath('notes/todo.md'), {
    path: 'notes/todo.md',
    name: 'todo.md'
  });
  assert.deepEqual(attachedFileFromPath('notes\\todo.md'), {
    path: 'notes\\todo.md',
    name: 'todo.md'
  });
});

test('attached files keep drop order, skip a path already attached, and keep the list identity', () => {
  const first = addAttachedFiles([], ['b.txt', 'my notes.md']);
  assert.deepEqual(
    first.map((file) => file.path),
    ['b.txt', 'my notes.md']
  );

  const second = addAttachedFiles(first, ['my notes.md', 'a.txt']);
  assert.deepEqual(
    second.map((file) => file.path),
    ['b.txt', 'my notes.md', 'a.txt']
  );

  assert.equal(addAttachedFiles(second, ['a.txt', 'b.txt']), second);
});

test('the send spells the chips out as @ mentions after the typed text', () => {
  assert.equal(
    composeMessageWithFiles('Summarize this', ['report.pdf', 'my notes.md']),
    'Summarize this\n\n@report.pdf @"my notes.md"'
  );
  assert.equal(composeMessageWithFiles('  Summarize this  ', []), 'Summarize this');
  assert.equal(composeMessageWithFiles('', ['report.pdf']), '@report.pdf');
  assert.equal(composeMessageWithFiles('   ', []), '');
});
