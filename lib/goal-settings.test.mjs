import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';

const { GOAL_LIMITS } = await createJiti(import.meta.url).import('./goal-policy.ts');
const {
  GOAL_SETTINGS_KEY,
  goalLimitsFromSettings,
  readGoalLimits,
  readGoalLimitsSync,
  writeGoalLimits
} = await createJiti(import.meta.url).import('./goal-settings.ts');

const deep = { maxContinuations: 10, maxTokens: 500_000, maxElapsedMs: 60 * 60_000 };

test('stored defaults fall back field by field, never unbounded', () => {
  assert.deepEqual(goalLimitsFromSettings({}), GOAL_LIMITS);
  assert.deepEqual(goalLimitsFromSettings({ [GOAL_SETTINGS_KEY]: null }), GOAL_LIMITS);
  assert.deepEqual(goalLimitsFromSettings({ [GOAL_SETTINGS_KEY]: deep }), deep);
  // A hand-edited value out of range only loses that field.
  assert.deepEqual(
    goalLimitsFromSettings({
      [GOAL_SETTINGS_KEY]: { maxContinuations: 0, maxTokens: 500_000, maxElapsedMs: 60 * 60_000 }
    }),
    { ...deep, maxContinuations: GOAL_LIMITS.maxContinuations }
  );
  assert.deepEqual(goalLimitsFromSettings({ [GOAL_SETTINGS_KEY]: { maxContinuations: 4 } }), {
    ...GOAL_LIMITS,
    maxContinuations: 4
  });
});

test('reading a missing or broken file means defaults', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-web-goal-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'settings.json');
  assert.deepEqual(readGoalLimitsSync(path), GOAL_LIMITS);
  assert.deepEqual(await readGoalLimits(path), GOAL_LIMITS);

  await writeFile(path, '{not json');
  assert.deepEqual(readGoalLimitsSync(path), GOAL_LIMITS);

  await writeFile(path, JSON.stringify({ [GOAL_SETTINGS_KEY]: deep }));
  assert.deepEqual(readGoalLimitsSync(path), deep);
});

test('writing defaults keeps the rest of the file and refuses out-of-range values', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-web-goal-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'settings.json');
  await writeFile(path, JSON.stringify({ defaultModel: 'faux-model' }));

  assert.deepEqual(await writeGoalLimits(deep, path), deep);
  assert.deepEqual(await readGoalLimits(path), deep);
  const written = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(written.defaultModel, 'faux-model');
  assert.deepEqual(written[GOAL_SETTINGS_KEY], deep);

  await assert.rejects(() => writeGoalLimits({ ...deep, maxTokens: 1 }, path));
  assert.deepEqual(await readGoalLimits(path), deep);
});
