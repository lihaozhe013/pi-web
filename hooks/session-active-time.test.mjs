import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { Script, createContext } from 'node:vm';
import { astNodes, declarationName, nodeText, parseSource } from '../lib/source-testing.mjs';

const source = await readFile(new URL('./useAgentSession.ts', import.meta.url), 'utf8');
const nodes = astNodes(parseSource(source, 'useAgentSession.ts'));

function callback(name) {
  const node = nodes.find(
    (node) => node.type === 'VariableDeclarator' && declarationName(node) === name
  );
  assert.ok(node, `missing ${name}`);
  return new Script(stripTypeScriptTypes(`(${nodeText(source, node.init.arguments[0])})`));
}

function setup({ snapshotActiveMs, liveActiveMs, liveSessionId = 'a', sessionId = 'a' } = {}) {
  const context = createContext({
    sessionStatsOverride: null,
    contextUsage: null,
    messages: [],
    session: { id: sessionId, name: 's' },
    sessionIdRef: { current: sessionId },
    liveTotalActiveMs:
      liveActiveMs === undefined ? null : { sessionId: liveSessionId, value: liveActiveMs },
    data: {
      sessionId,
      filePath: '',
      totalActiveMs: snapshotActiveMs,
      stats: { tokens: { total: 1 } },
      context: { messages: [] }
    },
    mergeSessionStats: (fileStats) => ({ ...fileStats, tokens: { total: 1 } })
  });
  return callback('sessionStats').runInContext(context)();
}

test('a live reading ahead of the snapshot is shown while a run appends entries', () => {
  const stats = setup({ snapshotActiveMs: 383_100_000, liveActiveMs: 406_500_000 });
  assert.equal(stats.totalActiveMs, 406_500_000);
});

test('a newer snapshot wins over an older live reading, as after a compaction', () => {
  // Manual compaction appends its entry and only reloads the session, so the
  // snapshot advances without another state read.
  const stats = setup({ snapshotActiveMs: 407_327_590, liveActiveMs: 406_500_000 });
  assert.equal(stats.totalActiveMs, 407_327_590);
});

test('a live reading from another session is ignored', () => {
  const stats = setup({ snapshotActiveMs: 1000, liveActiveMs: 999_000, liveSessionId: 'b' });
  assert.equal(stats.totalActiveMs, 1000);
});

test('without either reading the panel shows none', () => {
  assert.equal(setup({}).totalActiveMs, undefined);
  assert.equal(setup({ liveActiveMs: 5000 }).totalActiveMs, 5000);
});
