import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { artifactName, pruneRuntime } from './portable.mjs';

async function fixtureTree(files) {
  const root = await mkdtemp(join(tmpdir(), 'pie-prune-'));
  const app = join(root, 'pie');
  for (const file of files) {
    const path = join(app, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'x');
  }
  return { root, app };
}

async function present(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

// The actual extracted-archive runtime smoke test is mandatory in packagePortable.
test('portable artifact names identify platform, architecture and Linux libc', () => {
  assert.equal(artifactName('0.1.0', 'linux', 'x64'), 'pie-0.1.0-linux-x64-glibc');
  assert.equal(artifactName('0.1.0', 'linux', 'arm64'), 'pie-0.1.0-linux-arm64-glibc');
  assert.equal(artifactName('0.1.0', 'win32', 'x64'), 'pie-0.1.0-win32-x64');
  assert.equal(
    artifactName('0.1.0-local.1', 'darwin', 'arm64'),
    'pie-0.1.0-local.1-darwin-arm64'
  );
});

test('reject ambiguous or unsafe artifact names', () => {
  assert.throws(() => artifactName('../secret', 'linux', 'x64'), /Invalid/);
  assert.throws(() => artifactName('1.0.0', 'freebsd', 'x64'), /Unsupported/);
  assert.throws(() => artifactName('1.0.0', 'linux', 'ia32'), /Unsupported/);
});

test('runtime pruning removes source maps, sharp, and Next.js docs', async () => {
  const { root, app } = await fixtureTree([
    'node_modules/@next/swc-linux-x64-gnu/binding.node',
    'node_modules/next/dist/server/chunk.js',
    'node_modules/next/dist/compiled/runtime.js.map',
    'node_modules/next/dist/docs/index.html',
    'node_modules/other/index.js',
    'node_modules/other/index.js.map',
    'node_modules/@img/sharp-linux-x64/lib/libvips.so',
    'bin/pie.js'
  ]);
  try {
    const removed = await pruneRuntime(app);
    assert.deepEqual(removed, { files: 2, bytes: 2 });

    assert.equal(await present(join(app, 'node_modules/next/dist/compiled/runtime.js.map')), false);
    assert.equal(await present(join(app, 'node_modules/other/index.js.map')), false);
    assert.equal(await present(join(app, 'node_modules/@img')), false);
    assert.equal(await present(join(app, 'node_modules/next/dist/docs')), false);

    // The running server still needs these.
    assert.equal(
      await present(join(app, 'node_modules/@next/swc-linux-x64-gnu/binding.node')),
      true
    );
    assert.equal(await present(join(app, 'node_modules/next/dist/server/chunk.js')), true);
    assert.equal(await present(join(app, 'node_modules/other/index.js')), true);
    assert.equal(await present(join(app, 'bin/pie.js')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime pruning does not follow symlinks out of node_modules', async () => {
  const { root, app } = await fixtureTree([
    'node_modules/@next/swc-linux-x64-gnu/binding.node',
    'node_modules/real/index.js.map',
    'node_modules/real/index.js'
  ]);
  const linked = join(app, 'node_modules/linked');
  try {
    await symlink(join(app, 'node_modules/real'), linked, 'dir').catch(() => null);
    await pruneRuntime(app);
    assert.equal(await present(join(app, 'node_modules/real/index.js.map')), false);
    assert.equal(await present(join(app, 'node_modules/real/index.js')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pruning refuses an install without the Next.js SWC binary', async () => {
  const { root, app } = await fixtureTree(['node_modules/@next/env/package.json']);
  try {
    await assert.rejects(pruneRuntime(app), /no @next\/swc binary/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('portable packaging keeps Node.js runtime commands and local-only packaging', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.release, undefined);
  assert.equal(pkg.scripts.start, 'node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 30141');
  assert.equal(pkg.scripts['package:portable'], 'node packaging/portable.mjs');
  assert.ok(pkg.files.includes('bin') && pkg.files.includes('.next'));
});
