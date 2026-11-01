import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import {
  DESKTOP_BUILD_ENV,
  linuxDesktopName,
  parseArguments,
  payloadKey,
  payloadManifest,
  rustBinDirs,
  withRustToolchain
} from './desktop.mjs';

const sha = 'a'.repeat(64);

test('payload keys identify a build, not just a version', () => {
  assert.equal(payloadKey('0.1.0', sha), '0.1.0-aaaaaaaaaaaa');
  assert.throws(() => payloadKey('../escape', sha), /Invalid/);
  assert.throws(() => payloadKey('0.1.0', 'not-a-digest'), /Invalid/);
});

test('linux archives name the version and architecture', () => {
  assert.equal(linuxDesktopName('0.1.0', 'x64'), 'pie-desktop-0.1.0-linux-x64');
  assert.throws(() => linuxDesktopName('0.1.0', 'ia32'), /Unsupported/);
});

test('the manifest carries everything the shell verifies', () => {
  assert.deepEqual(
    payloadManifest({
      name: 'pie-0.1.0-linux-x64-glibc',
      version: '0.1.0',
      sha256: sha,
      bytes: 42,
      commit: 'abc1234'
    }),
    {
      name: 'pie-0.1.0-linux-x64-glibc',
      version: '0.1.0',
      sha256: sha,
      bytes: 42,
      commit: 'abc1234',
      key: '0.1.0-aaaaaaaaaaaa'
    }
  );
});

test('the desktop payload is built without a service worker', () => {
  assert.equal(DESKTOP_BUILD_ENV.NEXT_PUBLIC_PIE_DESKTOP, '1');
});

test('arguments reach the build orchestration', () => {
  assert.deepEqual(parseArguments([]), {
    dev: false,
    payload: undefined,
    skipPayload: false
  });
  assert.equal(parseArguments(['--dev']).dev, true);
  assert.equal(parseArguments(['--skip-payload']).skipPayload, true);
  assert.equal(
    parseArguments(['--payload', 'build/portable/app.tar.gz']).payload?.endsWith('app.tar.gz'),
    true
  );
  assert.throws(() => parseArguments(['--payload']), /archive path/);
  assert.throws(() => parseArguments(['--nope']), /Unknown argument/);
});

test('rust install locations cover rustup defaults', () => {
  const home = join('home', 'me');
  assert.deepEqual(rustBinDirs({ HOME: home }), [join(home, '.cargo', 'bin')]);
  assert.deepEqual(rustBinDirs({ USERPROFILE: home, CARGO_HOME: join('usr', 'rust') }), [
    join('usr', 'rust', 'bin'),
    join(home, '.cargo', 'bin')
  ]);
  assert.deepEqual(rustBinDirs({}), []);
});

test('the build environment can find cargo when PATH does not', () => {
  const cargoName = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const cargoBin = join('usr', 'rust', 'bin');
  const env = {
    PATH: [join('usr', 'bin'), join('opt', 'node', 'bin')].join(delimiter),
    CARGO_HOME: join('usr', 'rust')
  };
  const patched = withRustToolchain(env, { exists: (file) => file === join(cargoBin, cargoName) });
  assert.equal(patched.PATH, [cargoBin, env.PATH].join(delimiter));
  // The caller's environment is not modified.
  assert.equal(env.PATH, [join('usr', 'bin'), join('opt', 'node', 'bin')].join(delimiter));

  // A cargo that is already on PATH needs no change.
  const onPath = { PATH: [cargoBin, join('usr', 'bin')].join(delimiter) };
  assert.equal(
    withRustToolchain(onPath, { exists: (file) => file === join(cargoBin, cargoName) }),
    onPath
  );
});

test('a missing rust toolchain fails with the install instructions', () => {
  assert.throws(() => withRustToolchain({ PATH: '' }, { exists: () => false }), /rustup\.rs/);
  assert.throws(
    () => withRustToolchain({ Path: '' }, { platform: 'win32', exists: () => false }),
    /Visual Studio Build Tools/
  );
});

test('the shell stays out of the npm package and ships no updater', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['desktop:build'], 'node packaging/desktop.mjs');
  assert.equal(pkg.scripts['desktop:dev'], 'node packaging/desktop.mjs --dev');
  assert.ok(!pkg.files.includes('src-tauri'));

  const config = JSON.parse(
    await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
  );
  assert.equal(config.plugins?.updater, undefined);
  assert.equal(config.app.withGlobalTauri, false);
  assert.deepEqual(config.app.windows, []);
  assert.ok(!('capabilities' in config.app.security));

  const build = JSON.parse(
    await readFile(new URL('../src-tauri/tauri.build.conf.json', import.meta.url), 'utf8')
  );
  assert.deepEqual(build.bundle.resources, {
    '../build/desktop/payload.tar.gz': 'payload.tar.gz',
    '../build/desktop/payload.json': 'payload.json'
  });
});
