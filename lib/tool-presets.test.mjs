import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
  CANONICAL_CODING_TOOLS,
  CONCRETE_TOOL_PRESET_VALUES,
  CONFIGURED_TOOL_PRESET,
  CUSTOM_TOOL_PRESET_PREFIX,
  PLAN_TOOL_PRESET,
  TOOL_PRESET_VALUES,
  PRESET_DEFAULT,
  PRESET_FULL,
  PRESET_NONE,
  PRESET_READ_ONLY,
  customPresetSelection,
  getPresetForSession,
  getPresetFromToolNames,
  getPresetFromTools,
  getToolNamesForPreset,
  getToolNamesForSelection,
  getWorkModeForPreset,
  isConcreteToolPreset,
  isToolPreset,
  isToolPresetSelection
} = await jiti.import('./tool-presets.ts');

const BUILTIN_NAMES = ['bash', 'powershell', 'read', 'edit', 'write', 'grep', 'find', 'ls'];

function toolEntries(activeNames, customNames = []) {
  const active = new Set(activeNames);
  return [...BUILTIN_NAMES, ...customNames].map((name) => ({
    name,
    description: name,
    active: active.has(name)
  }));
}

test('maps every tool preset to its built-in tools', () => {
  assert.deepEqual(getToolNamesForPreset('none'), PRESET_NONE);
  assert.deepEqual(getToolNamesForPreset('read-only'), PRESET_READ_ONLY);
  assert.deepEqual(getToolNamesForPreset('default'), PRESET_DEFAULT);
  assert.deepEqual(getToolNamesForPreset('full'), PRESET_FULL);
  assert.deepEqual(PRESET_READ_ONLY, ['read', 'grep', 'find', 'ls']);
});

test('recognizes presets while ignoring active custom tools', () => {
  const customNames = ['web_search', 'delegate'];

  assert.equal(getPresetFromTools(toolEntries([], customNames)), 'none');
  assert.equal(
    getPresetFromTools(toolEntries([...PRESET_READ_ONLY, ...customNames], customNames)),
    'read-only'
  );
  assert.equal(
    getPresetFromTools(toolEntries([...PRESET_DEFAULT, ...customNames], customNames)),
    'default'
  );
  assert.equal(
    getPresetFromTools(toolEntries([...PRESET_FULL, ...customNames], customNames)),
    'full'
  );
});

test('returns fresh tool arrays that callers can safely modify', () => {
  const names = getToolNamesForPreset('read-only');
  names.push('custom');
  assert.deepEqual(getToolNamesForPreset('read-only'), PRESET_READ_ONLY);
});

test('recognizes PowerShell as the shell in standard presets', () => {
  assert.equal(getPresetFromTools(toolEntries(['read', 'powershell', 'edit', 'write'])), 'default');
  assert.equal(
    getPresetFromTools(toolEntries(['powershell', 'read', 'edit', 'write', 'grep', 'find', 'ls'])),
    'full'
  );
});

test('the configured preset stands for "no explicit override"', () => {
  // Undefined is what makes callers omit toolNames, so pi resolves defaultTools (#700).
  assert.equal(getToolNamesForPreset(CONFIGURED_TOOL_PRESET), undefined);
  assert.equal(CONFIGURED_TOOL_PRESET, 'configured');

  assert.ok(isToolPreset(CONFIGURED_TOOL_PRESET));
  assert.ok(!isConcreteToolPreset(CONFIGURED_TOOL_PRESET));
  assert.deepEqual(
    TOOL_PRESET_VALUES.filter((preset) => !CONCRETE_TOOL_PRESET_VALUES.includes(preset)),
    [CONFIGURED_TOOL_PRESET, PLAN_TOOL_PRESET]
  );

  // Every concrete preset still resolves to a real tool list.
  for (const preset of CONCRETE_TOOL_PRESET_VALUES) {
    assert.ok(Array.isArray(getToolNamesForPreset(preset)), preset);
  }
});

test('Plan is read-only plus a stored work mode', () => {
  assert.equal(PLAN_TOOL_PRESET, 'plan');
  assert.ok(isToolPreset(PLAN_TOOL_PRESET));
  assert.ok(!isConcreteToolPreset(PLAN_TOOL_PRESET));
  // Plan pins the same tools as Read-only; the mode is what makes it different.
  assert.deepEqual(getToolNamesForPreset(PLAN_TOOL_PRESET), PRESET_READ_ONLY);
  assert.equal(getWorkModeForPreset(PLAN_TOOL_PRESET), 'plan');
  for (const preset of [...TOOL_PRESET_VALUES].filter((value) => value !== PLAN_TOOL_PRESET)) {
    assert.equal(getWorkModeForPreset(preset), undefined, preset);
  }
});

test('a stored Plan mode wins over the read-only tool names it shares', () => {
  assert.equal(getPresetForSession(PRESET_READ_ONLY, 'plan'), PLAN_TOOL_PRESET);
  assert.equal(getPresetForSession(PRESET_READ_ONLY, undefined), 'read-only');
  assert.equal(getPresetForSession(undefined, undefined), CONFIGURED_TOOL_PRESET);
  assert.equal(getPresetForSession(PRESET_FULL, undefined), 'full');
});

test('an active tool set never maps back to the configured or plan presets', () => {
  for (const tools of [
    PRESET_NONE,
    PRESET_READ_ONLY,
    PRESET_DEFAULT,
    PRESET_FULL,
    ['read', 'grep']
  ]) {
    // Plan also pins read-only tools, so only the stored mode can tell it apart.
    assert.ok(isConcreteToolPreset(getPresetFromToolNames(tools)), tools.join(','));
  }
});

test('custom preset selections round-trip to their tool lists', () => {
  const customPresets = [
    { id: 'review', tools: ['read', 'grep', 'find', 'ls', 'bash'] },
    { id: 'write-heavy', tools: ['write', 'edit', 'read'] }
  ];

  assert.ok(isToolPresetSelection(customPresetSelection('review')));
  assert.ok(isToolPresetSelection('full'));
  assert.ok(!isToolPresetSelection('custom:'));
  assert.ok(!isToolPresetSelection('custom'));
  assert.ok(!isToolPresetSelection('bogus'));

  assert.deepEqual(getToolNamesForSelection('custom:review', customPresets), [
    'read',
    'grep',
    'find',
    'ls',
    'bash'
  ]);
  // A deleted preset resolves like "configured": no override, follow defaultTools.
  assert.deepEqual(getToolNamesForSelection('custom:gone', customPresets), undefined);
  // Built-ins keep resolving without a custom list.
  assert.deepEqual(getToolNamesForSelection('read-only'), PRESET_READ_ONLY);
  assert.equal(getToolNamesForSelection(CONFIGURED_TOOL_PRESET), undefined);
});

test('a session whose pinned tools match a custom preset reports that preset', () => {
  const customPresets = [{ id: 'review', tools: ['read', 'grep', 'find', 'ls', 'bash'] }];

  assert.equal(
    getPresetForSession(['read', 'bash', 'grep', 'find', 'ls'], undefined, customPresets),
    'custom:review'
  );
  // PowerShell is the shell alias: the stored list is matched through it too.
  assert.equal(
    getPresetForSession(['read', 'powershell', 'grep', 'find', 'ls'], undefined, customPresets),
    'custom:review'
  );
  // A built-in match wins over an identical custom preset.
  assert.equal(getPresetForSession(PRESET_FULL, undefined, customPresets), 'full');
  // Plan still wins over everything, and unknown lists keep the historical label.
  assert.equal(getPresetForSession(PRESET_READ_ONLY, 'plan', customPresets), PLAN_TOOL_PRESET);
  assert.equal(getPresetForSession(['read', 'edit'], undefined, customPresets), 'default');
  // Without a custom list the built-in resolution is unchanged.
  assert.equal(getPresetForSession(['read', 'edit'], undefined), 'default');
  assert.equal(getPresetForSession([], undefined), 'none');
});

test('custom work modes stay off for every selection shape', () => {
  assert.equal(getWorkModeForPreset(customPresetSelection('review')), undefined);
  assert.equal(getWorkModeForPreset('full'), undefined);
  assert.equal(getWorkModeForPreset(PLAN_TOOL_PRESET), 'plan');
});

test('the canonical coding tools are the stored tool names of custom presets', () => {
  assert.ok(CANONICAL_CODING_TOOLS.includes('bash'));
  assert.ok(!CANONICAL_CODING_TOOLS.includes('powershell'));
  assert.ok(CUSTOM_TOOL_PRESET_PREFIX.endsWith(':'));
});
