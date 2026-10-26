import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { parseJsonc } from './jsonc.ts';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
const packageLock = parseJsonc(readFileSync(new URL('../bun.lock', import.meta.url), 'utf8'));

// Keep one exact copy of every pi package so SDK modules share compatible APIs.
const PI_SCOPE = '@earendil-works/';

test('every pi package in the tree is a direct dependency pinned to its locked version', () => {
  const nameOf = (entry) => entry.slice(0, entry.lastIndexOf('@'));
  const locked = Object.entries(packageLock.packages).filter(([, entry]) =>
    nameOf(entry[0]).startsWith(PI_SCOPE)
  );
  assert.ok(locked.length > 0, 'the lockfile holds pi packages');
  for (const [path, entry] of locked) {
    const name = nameOf(entry[0]);
    const version = entry[0].slice(entry[0].lastIndexOf('@') + 1);
    assert.equal(path, name, `${path}: a second copy of ${name}`);
    assert.equal(
      packageJson.dependencies[name],
      version,
      `${name} must be a dependency pinned to ${version}`
    );
  }
  for (const [name, version] of Object.entries(packageJson.dependencies)) {
    if (!name.startsWith(PI_SCOPE)) continue;
    assert.equal(
      packageLock.packages[name]?.[0],
      `${name}@${version}`,
      `${name} is pinned but not locked at ${version}`
    );
  }
});
