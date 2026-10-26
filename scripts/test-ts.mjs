// Runs the unit tests that exercise TSX sources through the `typescript5`
// compiler API. These stay on TypeScript 5 because TypeScript 7's native
// compiler no longer ships an in-process parse/transpile JS API.
// Extra CLI args are forwarded to `node --test`, e.g. a name pattern.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['app', 'components', 'hooks', 'lib', 'public'];
const importPattern = /from\s+['"]typescript5['"]/;

const files = roots.flatMap((root) =>
  readdirSync(root, { recursive: true })
    .filter((path) => path.endsWith('.test.mjs'))
    .map((path) => join(root, path))
    .filter((path) => importPattern.test(readFileSync(path, 'utf8')))
);

if (files.length === 0) {
  console.error('No test files import typescript5; nothing to run.');
  process.exit(1);
}

const { status } = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', ...files, ...process.argv.slice(2)],
  { stdio: 'inherit' }
);
process.exit(status ?? 1);
