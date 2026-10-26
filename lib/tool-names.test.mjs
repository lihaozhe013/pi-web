import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { isExplorationToolName, isListToolName, isSearchToolName } =
  await jiti.import('./tool-names.ts');

test('read, search, and list tools count as exploration', () => {
  for (const name of ['read', 'read_file', 'fs.read', 'mcp__fs__read_file']) {
    assert.equal(isExplorationToolName(name), true, name);
  }
  for (const name of ['grep', 'find', 'ls', 'mcp__fs__grep', 'search.find']) {
    assert.equal(isExplorationToolName(name), true, name);
  }
});

test('a name that merely contains a search word stays a normal tool', () => {
  for (const name of [
    'write',
    'edit',
    'bash',
    'powershell',
    'glob',
    'ls_dir',
    'find_user',
    'codegrep',
    'list_issues',
    'mcp__github__list_issues',
    'tool_search',
    'codemode',
    'ask_user',
    'Agent'
  ]) {
    assert.equal(isExplorationToolName(name), false, name);
  }
});

test('searches and listings are told apart for the status line', () => {
  assert.equal(isSearchToolName('grep'), true);
  assert.equal(isSearchToolName('find'), true);
  assert.equal(isSearchToolName('ls'), false);
  assert.equal(isListToolName('ls'), true);
  assert.equal(isListToolName('mcp__fs__ls'), true);
  assert.equal(isListToolName('grep'), false);
});
