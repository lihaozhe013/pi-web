import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DESKTOP_BUILD_ENV,
  linuxDesktopName,
  parseArguments,
  payloadKey,
  payloadManifest
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
