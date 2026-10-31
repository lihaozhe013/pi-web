import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { COMMIT_LENGTH, UNKNOWN_COMMIT, formatAppVersion, shortCommit } =
  await jiti.import('./app-version.ts');

test('the short commit is the first seven characters', () => {
  assert.equal(COMMIT_LENGTH, 7);
  assert.equal(shortCommit('1c02256b9e2f1a0c3d4e5f60718293a4b5c6d7e8'), '1c02256');
  assert.equal(shortCommit('  1c02256\n'), '1c02256');
  assert.equal(shortCommit('abc'), 'abc');
  assert.equal(shortCommit(''), UNKNOWN_COMMIT);
  assert.equal(shortCommit(undefined), UNKNOWN_COMMIT);
  assert.equal(shortCommit(null), UNKNOWN_COMMIT);
});

test('the version carries the commit as build metadata', () => {
  assert.equal(formatAppVersion('0.1.0', '1c02256b9e2f1a0'), '0.1.0+1c02256');
  assert.equal(formatAppVersion(' 0.1.0 ', ' abc1234 '), '0.1.0+abc1234');
  // A build without a commit (or version) still reads as a version.
  assert.equal(formatAppVersion('0.1.0', UNKNOWN_COMMIT), '0.1.0');
  assert.equal(formatAppVersion('0.1.0', undefined), '0.1.0');
  assert.equal(formatAppVersion(undefined, '1c02256'), '0.0.0+1c02256');
  assert.equal(formatAppVersion(undefined, undefined), '0.0.0');
});
