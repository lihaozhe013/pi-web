import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { normalizeTaskConfig, readTaskConfig, writeTaskConfig, taskConfigPath } =
  await jiti.import('./config.ts');

async function fixture(t) {
  const agentDir = await mkdtemp(join(tmpdir(), 'pie-task-config-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  return agentDir;
}

test('a model is a provider and an id, or nothing at all', async () => {
  assert.deepEqual(normalizeTaskConfig({}).model, null);
  assert.deepEqual(
    normalizeTaskConfig({ model: { provider: 'anthropic', modelId: 'claude' } }).model,
    { provider: 'anthropic', modelId: 'claude' }
  );
  // A half-written model falls back to Pi's own default instead of failing.
  assert.equal(normalizeTaskConfig({ model: { provider: 'anthropic' } }).model, null);
  assert.equal(normalizeTaskConfig({ model: { provider: ' ', modelId: 'claude' } }).model, null);
  assert.equal(normalizeTaskConfig({ model: 'anthropic/claude' }).model, null);
});

test('a timeout can be unlimited, and a bad value falls back to the default', () => {
  assert.equal(normalizeTaskConfig({ taskTimeoutMs: null }).taskTimeoutMs, null);
  assert.equal(normalizeTaskConfig({ verifyTimeoutMs: null }).verifyTimeoutMs, null);
  // A typo must not silently remove the watchdog.
  assert.equal(normalizeTaskConfig({ taskTimeoutMs: 0 }).taskTimeoutMs, 3_600_000);
  assert.equal(normalizeTaskConfig({ taskTimeoutMs: 'soon' }).taskTimeoutMs, 3_600_000);
  assert.equal(normalizeTaskConfig({}).verifyTimeoutMs, 600_000);
});

test('writing a model keeps the rest of the configuration', async (t) => {
  const agentDir = await fixture(t);
  const written = writeTaskConfig(
    { model: { provider: 'openai', modelId: 'gpt-5' } },
    agentDir
  );
  assert.equal(written.allowAskUser, false);
  assert.equal(written.commitMessage, 'chore(task): #{id} {title}');
  assert.deepEqual(readTaskConfig(agentDir).model, { provider: 'openai', modelId: 'gpt-5' });

  const file = JSON.parse(await readFile(taskConfigPath(agentDir), 'utf8'));
  assert.deepEqual(file.model, { provider: 'openai', modelId: 'gpt-5' });
  assert.equal(file.verifyTimeoutMs, 600_000);
});

test('clearing the model writes null and leaves no stale selection', async (t) => {
  const agentDir = await fixture(t);
  writeTaskConfig({ model: { provider: 'openai', modelId: 'gpt-5' } }, agentDir);
  const cleared = writeTaskConfig({ model: null }, agentDir);
  assert.equal(cleared.model, null);
  assert.equal(readTaskConfig(agentDir).model, null);
});
