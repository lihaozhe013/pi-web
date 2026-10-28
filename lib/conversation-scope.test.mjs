import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const root = await mkdtemp(join(tmpdir(), 'pi-web-conversation-scope-'));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
const jiti = createJiti(import.meta.url, {
  alias: { '@': process.cwd() },
  interopDefault: true,
  moduleCache: false
});
const sdk = await jiti.import('@earendil-works/pi-coding-agent');
const reader = await jiti.import('./session-reader.ts');
const runtime = await jiti.import('./rpc-manager.ts');
const { deleteSessions } = await jiti.import('./session-delete.ts');
const tree = await jiti.import('./session-tree.ts');
const ui = await jiti.import('./session-ui-state.ts');
const navigation = await jiti.import('./settings-navigation.ts');
const { SETTINGS_SEARCH_ENTRIES } = await jiti.import('./settings-search.ts');
const directories = await jiti.import('./new-session-context.ts');
const { isFilePathReferencedByEntries } = await jiti.import('./session-file-references-core.ts');
const { isMessageGroupAnchor } = await jiti.import('./message-display.ts');
const { sessionLeaseShowsActivity, canReleaseHiddenEventStream } = await jiti.import(
  './agent-event-connection.ts'
);
const { GET: getModels } = await jiti.import('../app/api/models/route.ts');
const { POST: validateDirectory } = await jiti.import('../app/api/cwd/validate/route.ts');
const previousRegistry = globalThis.__piSessions;
globalThis.__piSessions = new Map();
const managers = [];

test.after(async () => {
  for (const wrapper of globalThis.__piSessions.values()) await wrapper.shutdown?.();
  globalThis.__piSessions = previousRegistry;
  for (const manager of managers) reader.invalidateSessionPathCache(manager.getSessionId());
  reader.invalidateSessionListCache();
  reader.invalidateSessionManagerCache();
  ui.resetSessionUiStateCacheForTests();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

function session(id, extra = {}) {
  return {
    id,
    path: join(root, `${id}.jsonl`),
    cwd: '/project',
    projectRoot: '/project',
    projectKey: '/project',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    firstMessage: id,
    messageCount: 2,
    ...extra
  };
}

function treeInput(sessions, extra = {}) {
  return {
    sessions,
    uiState: { version: 1, revision: 0, sessions: {}, projects: {} },
    runningIds: new Set(),
    unreadIds: new Set(),
    selectedSessionId: null,
    currentProject: { key: '/project', root: '/project' },
    groupExpansion: {},
    moreShown: {},
    pinnedCollapsed: false,
    ...extra
  };
}

async function savedSession(name) {
  const cwd = join(root, name);
  await mkdir(cwd, { recursive: true });
  const manager = sdk.SessionManager.create(cwd, join(root, 'agent', 'sessions', name));
  manager.appendMessage({ role: 'user', content: name, timestamp: Date.now() });
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'Answer' }],
    api: 'openai-completions',
    provider: 'fixture',
    model: 'fixture',
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  });
  managers.push(manager);
  reader.cacheSessionPath(manager.getSessionId(), manager.getSessionFile());
  return manager;
}

test('removed implementations and HTTP routes do not exist', () => {
  for (const path of [
    'lib/subagents.ts',
    'lib/subagent-runtime.ts',
    'lib/subagent-extension.ts',
    'lib/subagent-settings.ts',
    'lib/subagent-queue.ts',
    'lib/worktree.ts',
    'lib/git-changes.ts',
    'lib/git-status.ts',
    'lib/git-types.ts',
    'lib/session-conversation.ts',
    'app/api/subagents',
    'app/api/worktrees',
    'components/AgentsConfig.tsx',
    'components/AgentSessionPanel.tsx',
    'components/subagent-viewer-state.ts'
  ])
    assert.equal(existsSync(path), false, path);
});

test('normal SDK sessions expose ordinary tools but no host-owned child-agent tools', async (t) => {
  const cwd = join(root, 'runtime');
  await mkdir(cwd, { recursive: true });
  const { session: wrapper, realSessionId } = await runtime.startRpcSession('new-runtime', '', cwd);
  t.after(() => wrapper.shutdown());
  await wrapper.waitUntilReady();
  const names = wrapper.inner.getAllTools().map((tool) => tool.name);
  assert.ok(names.includes('read'));
  assert.ok(names.includes('ask_user'));
  for (const name of ['Agent', 'get_subagent_result', 'steer_subagent']) {
    assert.equal(names.includes(name), false, name);
  }
  assert.equal(runtime.getRpcSession(realSessionId), wrapper);
});

test('directory grouping does not infer repositories, branches, or sibling checkouts', async () => {
  const repo = join(root, 'repository');
  const nested = join(repo, 'nested');
  await mkdir(join(repo, '.git'), { recursive: true });
  await mkdir(nested);
  const rows = await reader.attachSessionProjectInfo([
    session('repo', { cwd: repo }),
    session('nested', { cwd: nested })
  ]);
  assert.equal(rows[0].projectRoot, repo);
  assert.equal(rows[1].projectRoot, nested);
  assert.notEqual(rows[0].projectKey, rows[1].projectKey);
  assert.equal('branch' in rows[0], false);
  assert.equal('isWorktree' in rows[0], false);
  const response = await validateDirectory(
    new Request('http://localhost/api/cwd/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: nested })
    })
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).projectRoot, nested);
});

test('model lookup refuses missing directories instead of inferring a parent repository', async () => {
  const missing = join(root, 'repository-worktrees', 'gone');
  const response = await getModels(
    new Request(`http://localhost/api/models?cwd=${encodeURIComponent(missing)}`)
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, `Directory does not exist: ${missing}`);
});

test('forks remain separate rows and activity belongs only to the actual session', () => {
  const parent = session('parent');
  const fork = session('fork', { relation: { kind: 'fork', originSessionId: parent.id } });
  const model = tree.buildSessionTree(
    treeInput([parent, fork], {
      runningIds: new Set(['fork']),
      awaitingIds: new Set(['fork']),
      selectedSessionId: 'fork'
    })
  );
  const rows = model.rows.filter((row) => row.kind === 'session');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.conversation.id === 'parent').status.running, false);
  const child = rows.find((row) => row.conversation.id === 'fork');
  assert.equal(child.conversation, fork);
  assert.equal(child.status.running, true);
  assert.equal(child.status.awaiting, true);
  assert.equal(child.status.selected, true);
});

test('archive, pin and bulk-delete decisions operate on individual sessions', () => {
  const rows = [session('idle'), session('running'), session('pinned')];
  const input = treeInput(rows, {
    runningIds: new Set(['running']),
    uiState: { version: 1, revision: 0, sessions: { pinned: { pinnedAt: 1 } }, projects: {} }
  });
  assert.deepEqual(tree.conversationsToArchive(input, '/project', 1000, Date.parse('2026-02-01')), [
    'idle'
  ]);
  assert.deepEqual(tree.conversationsToDelete(input, '/project'), {
    ids: ['idle', 'pinned'],
    running: 1
  });
  assert.equal(tree.isConversationPinned(rows[2], input.uiState, input.runningIds), true);
  const state = { ...input.uiState, sessions: { idle: { archivedAt: Date.parse('2026-02-01') } } };
  assert.deepEqual(tree.archivedConversationIds({ ...input, uiState: state }), ['idle']);
});

test('deletion shuts down only requested sessions, keeps forks, and clears UI state', async () => {
  const parent = await savedSession('delete-parent');
  const parentId = parent.getSessionId();
  const parentPath = parent.getSessionFile();
  const { forkSessionBranch } = await jiti.import('./session-fork.ts');
  const fork = forkSessionBranch(parentPath);
  reader.cacheSessionPath(fork.sessionId, fork.path);
  const shutdown = [];
  globalThis.__piSessions.set(parentId, {
    sessionId: parentId,
    isRunning: () => false,
    shutdown: async () => {
      shutdown.push(parentId);
      globalThis.__piSessions.delete(parentId);
    }
  });
  globalThis.__piSessions.set(fork.sessionId, {
    sessionId: fork.sessionId,
    isRunning: () => true,
    shutdown: async () => {
      shutdown.push(fork.sessionId);
      globalThis.__piSessions.delete(fork.sessionId);
    }
  });
  await ui.updateSessionUiState({ action: 'set', ids: [parentId], pinned: true });
  const result = await deleteSessions([parentId, parentId], { keepRunning: true });
  assert.deepEqual(result, { deleted: [parentId], missing: [], running: [] });
  assert.deepEqual(shutdown, [parentId]);
  assert.equal(existsSync(parentPath), false);
  assert.equal(existsSync(fork.path), true);
  assert.equal(reader.readSessionHeader(fork.path).parentSession, undefined);
  assert.equal(ui.readSessionUiState().sessions[parentId], undefined);
  globalThis.__piSessions.delete(fork.sessionId);
  reader.invalidateSessionPathCache(fork.sessionId);
});

test('bulk deletion keeps a requested running session and reports missing ids', async () => {
  const manager = await savedSession('keep-running');
  const id = manager.getSessionId();
  globalThis.__piSessions.set(id, { sessionId: id, isRunning: () => true });
  const missing = '00000000-0000-4000-8000-000000000000';
  const result = await deleteSessions([id, missing], { keepRunning: true });
  assert.deepEqual(result, { deleted: [], missing: [missing], running: [id] });
  assert.equal(existsSync(manager.getSessionFile()), true);
  globalThis.__piSessions.delete(id);
});

test('settings have no agent manager and unknown saved categories fall back normally', () => {
  assert.equal(navigation.SETTINGS_SECTION_VALUES.includes('agents'), false);
  assert.equal(
    SETTINGS_SEARCH_ENTRIES.some((entry) => entry.section === 'agents'),
    false
  );
  assert.ok(navigation.SETTINGS_SECTION_VALUES.includes('instructions'));
  const storage = { getItem: () => JSON.stringify({ section: 'agents' }) };
  assert.equal(navigation.getLastSettingsSection('/project', storage), 'general');
});

test('directory context carries no checkout state', () => {
  const context = {
    cwd: '/one',
    project: { key: '/one', root: '/one' },
    projects: [
      { key: '/one', root: '/one' },
      { key: '/two', root: '/two' }
    ]
  };
  const moved = directories.contextForCwd(context, '/two');
  assert.deepEqual(Object.keys(moved).sort(), ['cwd', 'project', 'projects']);
  assert.deepEqual(moved.project, { key: '/two', root: '/two' });
  assert.equal(
    directories.newSessionContextKey(moved),
    directories.newSessionContextKey({ ...moved })
  );
});

test('only ordinary session activity holds leases and only standard messages anchor turns', () => {
  assert.equal(sessionLeaseShowsActivity({ running: true }), true);
  assert.equal(sessionLeaseShowsActivity({ awaitingInput: true }), true);
  assert.equal(canReleaseHiddenEventStream({ running: false, awaitingInput: false }), true);
  assert.equal(
    isMessageGroupAnchor({ role: 'custom', display: true, customType: 'extension-note' }),
    false
  );
  assert.equal(
    isMessageGroupAnchor({ role: 'custom', display: true, customType: 'compaction' }),
    true
  );
});

test('extension tool output does not acquire the removed tools path-authorizing privilege', () => {
  const path = '/private/fixture.txt';
  const result = (toolName) => [
    {
      type: 'message',
      id: 'result',
      parentId: null,
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        role: 'toolResult',
        toolCallId: 'call',
        toolName,
        content: [{ type: 'text', text: path }]
      }
    }
  ];
  assert.equal(isFilePathReferencedByEntries(path, result('read')), true);
  assert.equal(isFilePathReferencedByEntries(path, result('Agent')), false);
  assert.equal(isFilePathReferencedByEntries(path, result('mcp__remote__read')), false);
});

test('UI and runtime contain no specialized child-agent or checkout control paths', async () => {
  for (const path of [
    'components/AppShell.tsx',
    'components/SettingsPanel.tsx',
    'components/MessageView.tsx',
    'lib/rpc-manager.ts',
    'lib/types.ts',
    'lib/new-session-context.ts'
  ]) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /subagent|worktree/i, path);
  }
});
