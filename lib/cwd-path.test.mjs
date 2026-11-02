import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { normalizeCwd } = await jiti.import('./cwd-path.ts');

test('a working directory has one spelling: absolute', () => {
  assert.equal(normalizeCwd('~'), homedir());
  assert.equal(normalizeCwd('~/dev/project'), join(homedir(), 'dev', 'project'));
  assert.equal(normalizeCwd('./relative'), resolve('relative'));
  assert.equal(normalizeCwd('build'), resolve('build'));
});

test('an absolute path is kept as given, so the picker and the queue agree', () => {
  const absolute = resolve('/tmp/project');
  assert.equal(normalizeCwd(absolute), absolute);
});
