import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const configUrl = new URL('../next.config.ts', import.meta.url);
const source = await readFile(configUrl, 'utf8');

test('resolves config paths without CommonJS globals', async () => {
  assert.doesNotMatch(source, /\b__dirname\b/);
  assert.match(source, /dirname\(fileURLToPath\(import\.meta\.url\)\)/);

  const config = await import(`${configUrl.href}?esm-test`);
  assert.equal(typeof config.default.env.NEXT_PUBLIC_APP_VERSION, 'string');
  assert.match(config.default.env.NEXT_PUBLIC_APP_COMMIT, /^(?:[0-9a-f]{7,}|unknown)$/);

  // A portable build runs without .git and forwards the commit as an env var.
  process.env.PI_WEB_COMMIT = '1c02256b9e2f1a0c3d4e5f60718293a4b5c6d7e8';
  try {
    const forwarded = await import(`${configUrl.href}?esm-test-commit`);
    assert.equal(forwarded.default.env.NEXT_PUBLIC_APP_COMMIT, '1c02256');
  } finally {
    delete process.env.PI_WEB_COMMIT;
  }
});
