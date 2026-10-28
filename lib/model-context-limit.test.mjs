import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
  getModelsSettingsPath,
  readContextWindowLimit,
  readModelOverrideWindows,
  resetContextWindowLimitCacheForTests,
  withContextWindowLimit,
  writeContextWindowLimit
} = await jiti.import('./model-context-limit.ts');

const agentDir = mkdtempSync(join(tmpdir(), 'pi-web-context-limit-'));
const settingsPath = join(agentDir, 'pi-web-model-settings.json');
const modelsPath = join(agentDir, 'models.json');

test.after(() => {
  rmSync(agentDir, { recursive: true, force: true });
  resetContextWindowLimitCacheForTests();
});

test('getModelsSettingsPath joins the file into the agent dir', () => {
  assert.equal(getModelsSettingsPath(agentDir), join(agentDir, 'pi-web-model-settings.json'));
});

test('a missing file reads as no limit and a save round-trips through it', async () => {
  resetContextWindowLimitCacheForTests();
  assert.equal(readContextWindowLimit(settingsPath), null);

  assert.equal(await writeContextWindowLimit(350000, settingsPath), 350000);
  assert.equal(readContextWindowLimit(settingsPath), 350000);

  assert.equal(await writeContextWindowLimit(null, settingsPath), null);
  assert.equal(readContextWindowLimit(settingsPath), null);
});

test('a save keeps other settings in the file and drops the key when cleared', async () => {
  resetContextWindowLimitCacheForTests();
  writeFileSync(settingsPath, '{\n  "futureSetting": true\n}\n');

  await writeContextWindowLimit('350000', settingsPath);
  const saved = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(saved.futureSetting, true);
  assert.equal(saved.contextWindowLimit, 350000);

  await writeContextWindowLimit(null, settingsPath);
  const cleared = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(cleared.futureSetting, true);
  assert.equal('contextWindowLimit' in cleared, false);
});

test('invalid limits are refused and a corrupt file is read as unset', async () => {
  resetContextWindowLimitCacheForTests();
  await assert.rejects(() => writeContextWindowLimit(0, settingsPath), /positive whole number/);
  await assert.rejects(() => writeContextWindowLimit(-5, settingsPath), /positive whole number/);
  await assert.rejects(() => writeContextWindowLimit('abc', settingsPath), /positive whole number/);

  writeFileSync(settingsPath, '{ not json');
  assert.equal(readContextWindowLimit(settingsPath), null);

  // An explicit string count is accepted, like the per-model field's draft.
  assert.equal(await writeContextWindowLimit('350000', settingsPath), 350000);
  assert.equal(readContextWindowLimit(settingsPath), 350000);
});

function fakeRuntime(models) {
  const allModels = models;
  return {
    getModel: (providerId, modelId) =>
      allModels.find((m) => m.provider === providerId && m.id === modelId),
    getModels: (providerId) =>
      providerId ? allModels.filter((m) => m.provider === providerId) : allModels,
    getAllModels: () => allModels,
    getAvailable: async () => allModels,
    getAvailableSnapshot: () => allModels,
    unrelated: () => 'passthrough'
  };
}

const limit = () => 350000;
const noLimit = () => null;
const noOverrides = () => new Map();

test('the wrapper clamps only models above the limit', () => {
  const big = { provider: 'p', id: 'big', contextWindow: 1000000 };
  const small = { provider: 'p', id: 'small', contextWindow: 256000 };
  const unknown = { provider: 'p', id: 'unknown' };
  const zero = { provider: 'p', id: 'zero', contextWindow: 0 };
  const runtime = withContextWindowLimit(fakeRuntime([big, small, unknown, zero]), {
    readLimit: limit,
    readOverrideWindows: noOverrides
  });

  const models = runtime.getModels();
  assert.equal(models.length, 4);
  assert.equal(models[0].contextWindow, 350000);
  // Unchanged models keep object identity.
  assert.equal(models[1], small);
  assert.equal(models[2], unknown);
  assert.equal(models[3], zero);

  const single = runtime.getModel('p', 'big');
  assert.equal(single.contextWindow, 350000);
  // The source model is never mutated.
  assert.equal(big.contextWindow, 1000000);
  assert.deepEqual(
    runtime.getAvailableSnapshot().map((m) => m.contextWindow),
    [350000, 256000, undefined, 0]
  );
});

test('with no limit every model keeps its identity', () => {
  const big = { provider: 'p', id: 'big', contextWindow: 1000000 };
  const runtime = withContextWindowLimit(fakeRuntime([big]), {
    readLimit: noLimit,
    readOverrideWindows: noOverrides
  });
  const models = runtime.getModels();
  assert.equal(models[0], big);
  assert.equal(runtime.getModel('p', 'big'), big);
  assert.equal(runtime.unrelated(), 'passthrough');
});

test('an explicit models.json contextWindow replaces the default entirely', () => {
  const big = { provider: 'p', id: 'big', contextWindow: 1000000 };
  const other = { provider: 'p', id: 'other', contextWindow: 1000000 };
  const runtime = withContextWindowLimit(fakeRuntime([big, other]), {
    readLimit: limit,
    readOverrideWindows: () => new Map([['p', new Set(['big'])]])
  });
  const models = runtime.getModels();
  // Overridden model untouched; the sibling without an override is clamped.
  assert.equal(models[0], big);
  assert.equal(models[1].contextWindow, 350000);
});

test('a provider whose models come only from getModels is not touched, and passthrough works', () => {
  const small = { provider: 'p', id: 'small', contextWindow: 256000 };
  const runtime = withContextWindowLimit(fakeRuntime([small]), {
    readLimit: limit,
    readOverrideWindows: noOverrides
  });
  // getModels stays clamped per provider id, like the runtime's own contract.
  assert.equal(runtime.getModels('p')[0], small);
  assert.equal(runtime.getModels('missing').length, 0);
  assert.equal(runtime.unrelated(), 'passthrough');
});

test('readModelOverrideWindows names the models with an explicit window', () => {
  resetContextWindowLimitCacheForTests();
  writeFileSync(
    modelsPath,
    '{ "providers": { "p": { "modelOverrides": { "big": { "contextWindow": 500000 }, "other": { "maxTokens": 5 }, "bad": { "contextWindow": 0 } } } } }'
  );
  const windows = readModelOverrideWindows(modelsPath);
  assert.deepEqual([...windows.get('p')], ['big']);

  writeFileSync(modelsPath, '{ "providers": { } }');
  assert.equal(readModelOverrideWindows(modelsPath).size, 0);
});
