import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const values = await jiti.import('./mcp-config-values.ts');
const transport = await jiti.import('./mcp-transport.ts');
const { configValueEnvVarNames, isCommandConfigValue } = await jiti.import('./mcp-import.ts');
const { loadPiSdkInternals } = await jiti.import('./pi-sdk-internals.ts');

const internals = await loadPiSdkInternals();
assert.equal(internals.ok, true, internals.reason);

test('the server uses the very same value walk and PIE_PASSWORD rule', () => {
  assert.equal(transport.resolvedConfigValues, values.resolvedConfigValues);
  assert.equal(transport.findWebPasswordField, values.findWebPasswordField);
  assert.equal(transport.WEB_PASSWORD_VARIABLE, 'PIE_PASSWORD');
});

test("the browser's parsers find PIE_PASSWORD where the SDK's do", () => {
  const browser = { isCommandConfigValue, getConfigValueEnvVarNames: configValueEnvVarNames };
  for (const config of [
    { command: 'x', env: { A: '${PIE_PASSWORD}' } },
    { command: 'x', env: { A: '$pie_password' } },
    { command: 'x', env: { A: '$$PIE_PASSWORD' } },
    { command: 'x', env: { A: '!echo $PIE_PASSWORD' } },
    { url: 'https://x.example/mcp', headers: { Authorization: 'Bearer ${PIE_PASSWORD}' } },
    { url: 'https://x.example/mcp', oauth: { clientSecret: '${PIE_PASSWORD}' } },
    { url: 'https://x.example/mcp', env: { A: '${PIE_PASSWORD}' } },
    { command: 'x', headers: { A: '${PIE_PASSWORD}' } }
  ]) {
    assert.deepEqual(
      values.findWebPasswordField(config, browser),
      values.findWebPasswordField(config, internals),
      JSON.stringify(config)
    );
  }
});
