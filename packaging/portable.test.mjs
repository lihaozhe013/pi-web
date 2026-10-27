import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { artifactName } from './portable.mjs';

// The actual extracted-archive runtime smoke test is mandatory in packagePortable.
test('portable artifact names identify platform, architecture and Linux libc', () => {
  assert.equal(artifactName('0.1.0', 'linux', 'x64'), 'pi-web-0.1.0-linux-x64-glibc');
  assert.equal(artifactName('0.1.0', 'linux', 'arm64'), 'pi-web-0.1.0-linux-arm64-glibc');
  assert.equal(artifactName('0.1.0', 'win32', 'x64'), 'pi-web-0.1.0-win32-x64');
  assert.equal(
    artifactName('0.1.0-local.1', 'darwin', 'arm64'),
    'pi-web-0.1.0-local.1-darwin-arm64'
  );
});

test('reject ambiguous or unsafe artifact names', () => {
  assert.throws(() => artifactName('../secret', 'linux', 'x64'), /Invalid/);
  assert.throws(() => artifactName('1.0.0', 'freebsd', 'x64'), /Unsupported/);
  assert.throws(() => artifactName('1.0.0', 'linux', 'ia32'), /Unsupported/);
});

test('portable packaging keeps Node.js runtime commands and local-only packaging', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.release, undefined);
  assert.equal(
    pkg.scripts.start,
    'node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 30141'
  );
  assert.equal(pkg.scripts['package:portable'], 'node packaging/portable.mjs');
  assert.ok(pkg.files.includes('bin') && pkg.files.includes('.next'));
});
