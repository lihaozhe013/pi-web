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

export function getPresetFromToolNames(toolNames: readonly string[]): ConcreteToolPreset {
  if (toolNames.length === 0) return 'none';

  const active = toolNames
    .map((name) => (name === 'powershell' ? 'bash' : name))
    .filter((name) => BUILTIN_TOOL_NAMES.has(name))
    .sort()
    .join(',');

  if (active === [...PRESET_READ_ONLY].sort().join(',')) return 'read-only';
  if (active === [...PRESET_DEFAULT].sort().join(',')) return 'default';
  if (active === [...PRESET_FULL].sort().join(',')) return 'full';
  return 'default';
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
export function getWorkModeForPreset(preset: ToolPreset): 'plan' | undefined {
  return preset === PLAN_TOOL_PRESET ? 'plan' : undefined;
}

/**
 * The preset a session is on. A stored Plan mode wins over the tool names, because Plan pins
 * the same read-only tools as the Read-only preset.
 */
export function getPresetForSession(
  toolNames: readonly string[] | undefined,
  workMode: 'plan' | undefined
): ToolPreset {
  if (workMode === 'plan') return PLAN_TOOL_PRESET;
  return toolNames !== undefined ? getPresetFromToolNames(toolNames) : CONFIGURED_TOOL_PRESET;
}
