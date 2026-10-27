export interface ToolEntry {
  name: string;
  description: string;
  active: boolean;
  /** Active, but left out of requests: the model calls it only from codemode scripts. */
  declarationHidden?: boolean;
  parameters?: Record<string, unknown>;
  promptGuidelines?: string[];
}

/** Presets that pin an explicit tool list onto the session. */
export const CONCRETE_TOOL_PRESET_VALUES = ['none', 'read-only', 'default', 'full'] as const;
export type ConcreteToolPreset = (typeof CONCRETE_TOOL_PRESET_VALUES)[number];

/**
 * "configured" is not a tool list: it means "send no override", so pi resolves the
 * loadout from settings.json defaultTools exactly like the `pi` CLI does. Sessions
 * left on it stay unpinned and keep following the setting as it changes.
 */
export const CONFIGURED_TOOL_PRESET = 'configured';

/**
 * "plan" pins the read-only tools like "read-only" does, and additionally stores a work
 * mode: the agent discusses and asks questions instead of implementing. The two cannot be
 * told apart by tool names, so the mode is persisted separately (`lib/work-mode.ts`).
 */
export const PLAN_TOOL_PRESET = 'plan';
export const TOOL_PRESET_VALUES = [
  'configured',
  PLAN_TOOL_PRESET,
  'none',
  'read-only',
  'default',
  'full'
] as const;
export type ToolPreset = (typeof TOOL_PRESET_VALUES)[number];

export const PRESET_NONE: string[] = [];
export const PRESET_READ_ONLY: string[] = ['read', 'grep', 'find', 'ls'];
export const PRESET_DEFAULT: string[] = ['read', 'bash', 'edit', 'write'];
export const PRESET_FULL: string[] = ['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls'];

const BUILTIN_TOOL_NAMES = new Set([...PRESET_FULL, 'powershell']);

/** The canonical coding tool names a custom preset may combine (`powershell` is a platform shell alias). */
export const CANONICAL_CODING_TOOLS: readonly string[] = PRESET_FULL;

export function isToolPreset(value: unknown): value is ToolPreset {
  return typeof value === 'string' && (TOOL_PRESET_VALUES as readonly string[]).includes(value);
}

export function isConcreteToolPreset(value: unknown): value is ConcreteToolPreset {
  return (
    typeof value === 'string' && (CONCRETE_TOOL_PRESET_VALUES as readonly string[]).includes(value)
  );
}

export function getPresetFromTools(tools: ToolEntry[]): ConcreteToolPreset {
  const activeTools = tools.filter((t) => t.active);
  return getPresetFromToolNames(activeTools.map((tool) => tool.name));
}

function canonicalCodingToolKey(toolNames: readonly string[]): string {
  return toolNames
    .map((name) => (name === 'powershell' ? 'bash' : name))
    .filter((name) => BUILTIN_TOOL_NAMES.has(name))
    .sort()
    .join(',');
}

const CANONICAL_KEY_READ_ONLY = canonicalCodingToolKey(PRESET_READ_ONLY);
const CANONICAL_KEY_DEFAULT = canonicalCodingToolKey(PRESET_DEFAULT);
const CANONICAL_KEY_FULL = canonicalCodingToolKey(PRESET_FULL);

/** The built-in preset whose tool set is exactly `key`, or undefined for any other list. */
function builtinPresetForKey(key: string): ConcreteToolPreset | undefined {
  if (key === CANONICAL_KEY_READ_ONLY) return 'read-only';
  if (key === CANONICAL_KEY_DEFAULT) return 'default';
  if (key === CANONICAL_KEY_FULL) return 'full';
  return undefined;
}

export function getPresetFromToolNames(toolNames: readonly string[]): ConcreteToolPreset {
  if (toolNames.length === 0) return 'none';
  return builtinPresetForKey(canonicalCodingToolKey(toolNames)) ?? 'default';
}

/** Undefined means "no explicit selection": let pi resolve settings.json defaultTools. */
export function getToolNamesForPreset(preset: ToolPreset): string[] | undefined {
  if (preset === CONFIGURED_TOOL_PRESET) return undefined;
  if (preset === PLAN_TOOL_PRESET) return [...PRESET_READ_ONLY];
  if (preset === 'none') return [...PRESET_NONE];
  if (preset === 'read-only') return [...PRESET_READ_ONLY];
  if (preset === 'full') return [...PRESET_FULL];
  return [...PRESET_DEFAULT];
}

/** The work mode a preset turns on, or undefined when the session has no special mode. */
export function getWorkModeForPreset(preset: ToolPresetSelection): 'plan' | undefined {
  return preset === PLAN_TOOL_PRESET ? 'plan' : undefined;
}

/** A reference to one user-defined preset, as the custom preset list holds it. */
export interface CustomToolPresetRef {
  id: string;
  tools: readonly string[];
}

export const CUSTOM_TOOL_PRESET_PREFIX = 'custom:';

/** A built-in preset or a `custom:<id>` reference into the user's preset list. */
export type ToolPresetSelection = ToolPreset | `${typeof CUSTOM_TOOL_PRESET_PREFIX}${string}`;

export function isToolPresetSelection(value: unknown): value is ToolPresetSelection {
  return (
    isToolPreset(value) ||
    (typeof value === 'string' &&
      value.startsWith(CUSTOM_TOOL_PRESET_PREFIX) &&
      value.length > CUSTOM_TOOL_PRESET_PREFIX.length)
  );
}

/** The `custom:<id>` selection for a preset, so callers never spell the prefix. */
export function customPresetSelection(id: string): ToolPresetSelection {
  return `${CUSTOM_TOOL_PRESET_PREFIX}${id}`;
}

function matchCustomPreset(
  customPresets: readonly CustomToolPresetRef[],
  key: string
): ToolPresetSelection | undefined {
  for (const preset of customPresets) {
    if (canonicalCodingToolKey(preset.tools) === key) return customPresetSelection(preset.id);
  }
  return undefined;
}

/**
 * The tool list a selection pins, or undefined for "configured": a custom preset that no
 * longer exists (deleted in another window, or cleared with the session still preferring
 * it) resolves that way, so sessions follow the configured defaults again.
 */
export function getToolNamesForSelection(
  selection: ToolPresetSelection,
  customPresets: readonly CustomToolPresetRef[] = []
): string[] | undefined {
  if (selection.startsWith(CUSTOM_TOOL_PRESET_PREFIX)) {
    const id = selection.slice(CUSTOM_TOOL_PRESET_PREFIX.length);
    const preset = customPresets.find((candidate) => candidate.id === id);
    return preset ? [...preset.tools] : undefined;
  }
  return isToolPreset(selection) ? getToolNamesForPreset(selection) : undefined;
}

/**
 * The preset a session is on. A stored Plan mode wins over the tool names, because Plan pins
 * the same read-only tools as the Read-only preset. A custom preset is recognized by an
 * exact tool-set match against the user's list; unknown lists keep the historical `default`
 * label.
 */
export function getPresetForSession(
  toolNames: readonly string[] | undefined,
  workMode: 'plan' | undefined,
  customPresets: readonly CustomToolPresetRef[] = []
): ToolPresetSelection {
  if (workMode === 'plan') return PLAN_TOOL_PRESET;
  if (toolNames === undefined) return CONFIGURED_TOOL_PRESET;
  if (toolNames.length === 0) return 'none';
  const key = canonicalCodingToolKey(toolNames);
  return builtinPresetForKey(key) ?? matchCustomPreset(customPresets, key) ?? 'default';
}
