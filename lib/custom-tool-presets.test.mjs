import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
  CUSTOM_TOOL_PRESET_TOOLS,
  makeCustomToolPresetId,
  normalizeCustomPresetTools,
  parseCustomToolPresetDocument,
  validateCustomToolPresetDocument,
  customPresetNameError
} = await jiti.import('./custom-tool-presets-shared.ts');
const {
  getCustomToolPresetsPath,
  readCustomToolPresets,
  resetCustomToolPresetsCacheForTests,
  writeCustomToolPresets
} = await jiti.import('./custom-tool-presets.ts');

async function withAgentDir(run) {
  const agentDir = await mkdtemp(join(tmpdir(), 'pi-web-custom-tool-presets-'));
  resetCustomToolPresetsCacheForTests();
  try {
    await run(agentDir);
  } finally {
    resetCustomToolPresetsCacheForTests();
  }
}

const DOCUMENT = {
  version: 1,
  presets: [
    { id: 'review', name: 'Review', tools: ['read', 'bash', 'grep', 'find', 'ls'] },
    { id: 'writing', name: 'Writing', tools: ['powershell', 'read', 'edit', 'write'] }
  ]
};

test('valid documents parse; anything else is refused', () => {
  const presets = parseCustomToolPresetDocument(DOCUMENT);
  assert.equal(presets.length, 2);
  // powershell is stored canonically as bash, in canonical order.
  assert.deepEqual(presets[1].tools, ['bash', 'read', 'edit', 'write']);

  for (const bad of [
    null,
    'no',
    {},
    { version: 2, presets: [] },
    { version: 1 },
    { version: 1, presets: 'no' },
    { version: 1, presets: [[]] },
    { version: 1, presets: [{ id: 'a' }] },
    { version: 1, presets: [{ id: 'a', name: '', tools: ['read'] }] },
    { version: 1, presets: [{ id: 'a', name: 'x', tools: [] }] },
    { version: 1, presets: [{ id: 'a', name: 'x', tools: ['rm'] }] },
    { version: 1, presets: [{ id: 'a b', name: 'x', tools: ['read'] }] },
    { version: 1, presets: [{ id: 'a', name: 'x', tools: ['read'] }, { id: 'A', name: 'y', tools: ['edit'] }] },
    {
      version: 1,
      presets: [
        { id: 'a', name: 'Same', tools: ['read'] },
        { id: 'b', name: 'same', tools: ['edit'] }
      ]
    }
  ]) {
    assert.equal(parseCustomToolPresetDocument(bad), undefined, JSON.stringify(bad));
  }

  assert.throws(() => validateCustomToolPresetDocument({ version: 1, presets: 'no' }));
});

test('tool lists are normalized: canonical order, dedup, powershell alias', () => {
  assert.deepEqual(normalizeCustomPresetTools(['grep', 'read', 'read', 'powershell']), [
    'bash',
    'read',
    'grep'
  ]);
  assert.equal(normalizeCustomPresetTools([]), undefined);
  assert.equal(normalizeCustomPresetTools('read'), undefined);
  assert.equal(normalizeCustomPresetTools(['nope']), undefined);
  assert.deepEqual(normalizeCustomPresetTools(CUSTOM_TOOL_PRESET_TOOLS), CUSTOM_TOOL_PRESET_TOOLS);
});

test('names are trimmed, length-limited, and unique per list', () => {
  const presets = [{ id: 'a', name: 'Alpha', tools: ['read'] }];
  assert.equal(customPresetNameError(presets, 'a', '  '), 'required');
  assert.equal(customPresetNameError(presets, 'a', 'x'.repeat(41)), 'too-long');
  assert.equal(customPresetNameError(presets, 'b', 'alpha'), 'taken');
  assert.equal(customPresetNameError(presets, 'a', 'alpha'), undefined);
  assert.equal(customPresetNameError(presets, 'b', '  Beta  '), undefined);
});

test('generated ids match the stored shape', () => {
  const id = makeCustomToolPresetId();
  assert.match(id, /^[A-Za-z0-9][A-Za-z0-9_-]*$/);
  assert.notEqual(id, makeCustomToolPresetId());
});

test('writes atomically, reads back, and survives a fresh cache', async () => {
  await withAgentDir(async (agentDir) => {
    const path = getCustomToolPresetsPath(agentDir);
    const saved = await writeCustomToolPresets(DOCUMENT, path);
    assert.equal(saved.length, 2);

    const onDisk = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(Object.keys(onDisk).sort(), ['presets', 'version']);
    assert.deepEqual(readCustomToolPresets(path), saved);

    resetCustomToolPresetsCacheForTests();
    assert.deepEqual(readCustomToolPresets(path), saved);
  });
});

test('a missing file reads as empty without being created', async () => {
  await withAgentDir(async (agentDir) => {
    assert.deepEqual(readCustomToolPresets(getCustomToolPresetsPath(agentDir)), []);
    const entries = await readdir(agentDir);
    assert.deepEqual(entries, []);
  });
});

test('an unparsable file reads as empty and is set aside by the next write', async () => {
  await withAgentDir(async (agentDir) => {
    const path = getCustomToolPresetsPath(agentDir);
    await writeFile(path, '{ not json', 'utf8');

    assert.deepEqual(readCustomToolPresets(path), []);

    await writeCustomToolPresets(DOCUMENT, path);
    const entries = await readdir(agentDir);
    assert.deepEqual(
      entries.filter((name) => name.startsWith('pi-web-tool-presets.json.corrupt-')).length,
      1
    );
    assert.deepEqual(
      JSON.parse(await readFile(path, 'utf8')).presets,
      parseCustomToolPresetDocument(DOCUMENT)
    );
  });
});

test('a later write replaces the whole list', async () => {
  await withAgentDir(async (agentDir) => {
    const path = getCustomToolPresetsPath(agentDir);
    await writeCustomToolPresets(DOCUMENT, path);
    await writeCustomToolPresets({ version: 1, presets: [] }, path);
    assert.deepEqual(readCustomToolPresets(path), []);
  });
});
