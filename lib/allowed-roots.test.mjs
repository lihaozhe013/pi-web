import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

// The approvals file lives beside Pie's other state, so the test moves the agent
// directory before anything reads or writes it.
const agentDir = mkdtempSync(join(tmpdir(), 'pie-allowed-roots-'));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const {
  ALLOWED_ROOTS_FILE,
  allowFileRoot,
  allowedRootsPath,
  getAdditionalAllowedRoots,
  resetAllowedRootsForTests
} = await createJiti(import.meta.url).import('./allowed-roots.ts');

test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

/** Start from no approvals at all, as a fresh install would. */
function forgetApprovals() {
  resetAllowedRootsForTests();
  rmSync(allowedRootsPath(), { force: true });
}

test('an approval is written beside the agent state and read back after a restart', () => {
  forgetApprovals();
  const approved = join(agentDir, 'projects', 'fresh');
  allowFileRoot(approved);

  const written = JSON.parse(readFileSync(allowedRootsPath(), 'utf8'));
  assert.equal(written.version, 1);
  assert.deepEqual(written.roots, [approved.replaceAll('\\', '/')]);

  // A restart drops the in-memory set; the file is what survives.
  resetAllowedRootsForTests();
  assert.ok(getAdditionalAllowedRoots().has(approved.replaceAll('\\', '/')));
});

test('approving the same directory twice keeps one entry and ignores separator style', () => {
  forgetApprovals();
  const approved = join(agentDir, 'projects', 'twice');
  allowFileRoot(approved);
  allowFileRoot(approved.replaceAll('\\', '/'));
  allowFileRoot('');

  const written = JSON.parse(readFileSync(allowedRootsPath(), 'utf8'));
  assert.deepEqual(written.roots, [approved.replaceAll('\\', '/')]);
});

test('an unreadable approval file approves nothing and is replaced on the next write', () => {
  forgetApprovals();
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(allowedRootsPath(), '{ not json', 'utf8');

  assert.equal(getAdditionalAllowedRoots().size, 0);

  allowFileRoot(join(agentDir, 'projects', 'after-damage'));
  assert.deepEqual(JSON.parse(readFileSync(allowedRootsPath(), 'utf8')), {
    version: 1,
    roots: [join(agentDir, 'projects', 'after-damage').replaceAll('\\', '/')]
  });
});

test('the file name is the documented one', () => {
  assert.equal(ALLOWED_ROOTS_FILE, 'pie-allowed-roots.json');
  assert.equal(allowedRootsPath(), join(agentDir, ALLOWED_ROOTS_FILE));
});
