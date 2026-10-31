import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  BUNDLED_GOAL_PACKAGE,
  bundledGoalExtensionPath,
  goalExtensionPaths,
  goalPackageInSettings,
  packageNameOfSource,
  resetBundledGoalExtensionPath
} = await jiti.import('./goal-package.ts');

test('a package source reduces to the package name', () => {
  const cases = [
    ['npm:pi-better-goal', 'pi-better-goal'],
    ['npm:pi-better-goal@0.10.4', 'pi-better-goal'],
    ['npm:@fyeeme/pi-goal@1.0.6', 'pi-goal'],
    ['git:github.com/tmonk/pi-goal-x@v0.34.1', 'pi-goal-x'],
    ['https://github.com/x/y.git', 'y'],
    ['./local-package', 'local-package'],
    ['/abs/path/pi-goal', 'pi-goal'],
    ['pi-goal', 'pi-goal'],
    ['', undefined]
  ];
  for (const [source, name] of cases) {
    assert.equal(packageNameOfSource(source), name, source);
  }
});

test('any configured goal package keeps the bundled one out', () => {
  assert.equal(goalPackageInSettings({}, {}), undefined);
  assert.equal(goalPackageInSettings(undefined), undefined);
  assert.equal(goalPackageInSettings({ packages: [] }, undefined), undefined);
  // A package, not a filename: only names that say goal count.
  assert.equal(goalPackageInSettings({ packages: ['npm:pi-better-goal'] }), 'pi-better-goal');
  assert.equal(goalPackageInSettings({ packages: ['npm:@fyeeme/pi-goal@1.0.6'] }), 'pi-goal');
  assert.equal(
    goalPackageInSettings({}, { packages: ['git:github.com/x/pi-goal-x'] }),
    'pi-goal-x'
  );
  // The object form narrows resources; the person still chose that package.
  assert.equal(
    goalPackageInSettings({ packages: [{ source: 'npm:pi-better-goal', extensions: [] }] }),
    'pi-better-goal'
  );
  for (const packages of [
    ['npm:pi-mcp-adapter'],
    ['npm:pi-subagents'],
    [{ source: 'npm:@plannotator/pi-extension' }],
    [42],
    [null]
  ]) {
    assert.equal(goalPackageInSettings({ packages }), undefined, JSON.stringify(packages));
  }
});

test('this build ships the goal package, and adds it path when nobody chose one', () => {
  resetBundledGoalExtensionPath();
  const path = bundledGoalExtensionPath();
  assert.ok(path, 'pi-better-goal is a dependency of Pi Web');
  assert.ok(existsSync(join(path, 'package.json')), path);
  const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  assert.equal(manifest.name, BUNDLED_GOAL_PACKAGE);
  // The loader follows the package's own manifest rather than a guessed entry.
  assert.deepEqual(manifest.pi.extensions, ['./src/index.ts']);

  assert.deepEqual(goalExtensionPaths({}, {}), [path]);
  // A person's own goal package wins, so two loops never run over one switch.
  assert.deepEqual(goalExtensionPaths({ packages: ['npm:pi-better-goal'] }, {}), []);
  assert.deepEqual(goalExtensionPaths({}, { packages: ['npm:pi-codex-goal'] }), []);
});
