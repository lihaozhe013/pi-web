import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { goalExtensionPaths } = await jiti.import('./goal-package.ts');
const { readGoalFacts } = await jiti.import('./goal-driver.ts');

/**
 * The bundled package is loaded the way a session loads it: an extension path,
 * not an import, so the package's own manifest and its peer modules decide
 * whether it works in this build.
 */
test('the bundled goal package loads from the app dependencies and registers /goal', async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-web-goal-agent-'));
  const cwd = mkdtempSync(join(tmpdir(), 'pi-web-goal-cwd-'));
  t.after(() => {
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  const settingsManager = SettingsManager.create(cwd, agentDir);
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager,
    resourceLoaderOptions: {
      extensionFactories: [],
      additionalExtensionPaths: goalExtensionPaths({}, {})
    }
  });
  assert.deepEqual(services.resourceLoader.getExtensions().errors, []);

  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.create(cwd, agentDir)
  });
  t.after(() => session.dispose?.());

  const commands = session.extensionRunner
    .getRegisteredCommands()
    .map((command) => command.invocationName);
  assert.ok(commands.includes('goal'), `goal is registered, got ${commands.join(', ')}`);

  // The package owns the records the bridge reads, and writes nothing yet.
  assert.equal(readGoalFacts(session.sessionManager.getBranch()), undefined);
});
