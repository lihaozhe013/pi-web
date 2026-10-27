'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/hooks/useI18n';
import {
  CANONICAL_CODING_TOOLS,
  CUSTOM_TOOL_PRESET_MAX_COUNT,
  CUSTOM_TOOL_PRESET_TOOLS,
  customPresetNameError,
  makeCustomToolPresetId,
  type CustomToolPreset
} from '@/lib/custom-tool-presets-shared';
import {
  ConfigButton,
  ConfigDetail,
  ConfigEmptyState,
  ConfigField,
  ConfigFooter,
  ConfigFooterStatus,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSectionTitle,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView
} from './SettingsUi';

interface Props {
  embedded: boolean;
  onClose: () => void;
  /** The list was saved; the session's composer reloads its copy. */
  onSaved: () => void;
}

/** The shell tool is stored canonically as `bash` and shown as one "shell" entry. */
const SHELL_TOOL = 'bash';

const START_TOOLS: Record<'read-only' | 'default' | 'full', readonly string[]> = {
  'read-only': ['read', 'grep', 'find', 'ls'],
  default: ['read', SHELL_TOOL, 'edit', 'write'],
  full: CUSTOM_TOOL_PRESET_TOOLS
};

/**
 * Settings section for the custom tool presets (`lib/custom-tool-presets.ts`):
 * the preset list beside an editor for the selected one. Edits stay in the
 * draft until Save replaces the whole server-side list; Delete is a two-step
 * button kept apart from Save.
 */
export function ToolPresetsSettings({ embedded, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<CustomToolPreset[] | null>(null);
  const [draft, setDraft] = useState<CustomToolPreset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameErrorId = useId();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/tools/presets', {
          cache: 'no-store',
          signal: controller.signal
        });
        const data = (await response.json()) as { presets?: CustomToolPreset[]; error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (controller.signal.aborted) return;
        const presets = data.presets ?? [];
        setLoaded(presets);
        setDraft(presets.map((preset) => ({ ...preset, tools: [...preset.tools] })));
        setSelectedId(presets[0]?.id ?? null);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    })();
    return () => controller.abort();
  }, []);

  const selected = draft.find((preset) => preset.id === selectedId) ?? null;
  const dirty =
    loaded !== null &&
    (draft.length !== loaded.length ||
      draft.some((preset) => {
        const saved = loaded.find((candidate) => candidate.id === preset.id);
        return (
          !saved ||
          saved.name !== preset.name ||
          saved.tools.length !== preset.tools.length ||
          saved.tools.some((tool, index) => tool !== preset.tools[index])
        );
      }));

  const updateSelected = (changes: Partial<CustomToolPreset>) => {
    if (!selected) return;
    setDraft((current) =>
      current.map((preset) => (preset.id === selected.id ? { ...preset, ...changes } : preset))
    );
    setSavedOk(false);
  };

  const toggleTool = (tool: string) => {
    if (!selected) return;
    const tools = selected.tools.includes(tool)
      ? selected.tools.filter((name) => name !== tool)
      : CUSTOM_TOOL_PRESET_TOOLS.filter(
          (name) => selected.tools.includes(name) || name === tool
        );
    updateSelected({ tools });
  };

  const addPreset = () => {
    const preset: CustomToolPreset = {
      id: makeCustomToolPresetId(),
      name: t('toolPresets.untitled'),
      tools: [...START_TOOLS['read-only']]
    };
    setDraft((current) => [...current, preset]);
    setSelectedId(preset.id);
    setConfirmingDelete(false);
    setError(null);
    // A new preset starts by naming it: select the suggestion once the field mounts.
    requestAnimationFrame(() => nameInputRef.current?.select());
  };

  const deleteSelected = () => {
    if (!selected) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDraft((current) => current.filter((preset) => preset.id !== selected.id));
    setSelectedId((current) => {
      const rest = draft.filter((preset) => preset.id !== current);
      return rest[0]?.id ?? null;
    });
    setConfirmingDelete(false);
    setError(null);
  };

  const save = async () => {
    if (saving) return;
    for (const preset of draft) {
      const nameError = customPresetNameError(draft, preset.id, preset.name);
      if (nameError) {
        setSelectedId(preset.id);
        setError(t(`toolPresets.errorName.${nameError}`));
        requestAnimationFrame(() => {
          nameInputRef.current?.focus();
          nameInputRef.current?.select();
        });
        return;
      }
      if (preset.tools.length === 0) {
        setSelectedId(preset.id);
        setError(t('toolPresets.errorNoTools', { name: preset.name }));
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/tools/presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 1, presets: draft })
      });
      const data = (await response.json()) as { presets?: CustomToolPreset[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      const presets = data.presets ?? [];
      setLoaded(presets);
      setDraft(presets.map((preset) => ({ ...preset, tools: [...preset.tools] })));
      setSavedOk(true);
      window.setTimeout(() => setSavedOk(false), 2000);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const atLimit = draft.length >= CUSTOM_TOOL_PRESET_MAX_COUNT;
  const nameError = selected
    ? customPresetNameError(draft, selected.id, selected.name)
    : undefined;

  return (
    <ConfigPanelShell
      embedded={embedded}
      title={t('toolPresets.title')}
      closeLabel={t('i18n.close')}
      onClose={onClose}
    >
      <p className="tool-presets-intro">{t('toolPresets.description')}</p>
      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarGroupLabel>{t('toolPresets.list')}</ConfigSidebarGroupLabel>
          <ConfigSidebarList>
            {draft.map((preset) => (
              <ConfigSidebarItem
                key={preset.id}
                active={preset.id === selectedId}
                onClick={() => {
                  setSelectedId(preset.id);
                  setConfirmingDelete(false);
                }}
              >
                <ConfigSidebarText className="tool-presets-item-name">
                  {preset.name || t('toolPresets.untitled')}
                </ConfigSidebarText>
                <ConfigSidebarText className="tool-presets-item-count">
                  {t('chat.toolCount', { count: preset.tools.length })}
                </ConfigSidebarText>
              </ConfigSidebarItem>
            ))}
          </ConfigSidebarList>
          <ConfigListAction
            onClick={addPreset}
            disabled={atLimit}
            title={atLimit ? t('toolPresets.limitReached', { count: CUSTOM_TOOL_PRESET_MAX_COUNT }) : undefined}
          >
            {t('toolPresets.newPreset')}
          </ConfigListAction>
        </ConfigSidebar>

        <ConfigDetail>
          {selected ? (
            <div className="tool-presets-form">
              <ConfigField label={t('toolPresets.name')}>
                <input
                  ref={nameInputRef}
                  type="text"
                  className="tool-presets-name-input"
                  value={selected.name}
                  maxLength={60}
                  aria-invalid={nameError !== undefined || undefined}
                  aria-describedby={nameError ? nameErrorId : undefined}
                  onBlur={() => {
                    // Inline validation on blur, not on every keystroke.
                    if (customPresetNameError(draft, selected.id, selected.name)) setError(null);
                  }}
                  onChange={(event) => updateSelected({ name: event.target.value })}
                />
                {nameError && (
                  <p id={nameErrorId} className="tool-presets-field-error">
                    {t(`toolPresets.errorName.${nameError}`)}
                  </p>
                )}
              </ConfigField>

              <ConfigField label={t('toolPresets.startFrom')}>
                <div className="tool-presets-start">
                  {(['read-only', 'default', 'full'] as const).map((preset) => (
                    <ConfigButton
                      key={preset}
                      size="small"
                      onClick={() => updateSelected({ tools: [...START_TOOLS[preset]] })}
                    >
                      {t(`toolPresets.start.${preset}`)}
                    </ConfigButton>
                  ))}
                </div>
              </ConfigField>

              <fieldset className="tool-presets-tools">
                <ConfigSectionTitle>{t('toolPresets.tools')}</ConfigSectionTitle>
                {CANONICAL_CODING_TOOLS.map((tool) => {
                  const checked = selected.tools.includes(tool);
                  return (
                    <label key={tool} className="tool-presets-tool">
                      <input type="checkbox" checked={checked} onChange={() => toggleTool(tool)} />
                      <code>{tool === SHELL_TOOL ? 'shell' : tool}</code>
                      <span>{t(`toolPresets.tool.${tool}`)}</span>
                    </label>
                  );
                })}
              </fieldset>

              <p className="tool-presets-summary">
                {selected.tools.length > 0
                  ? t('toolPresets.summary', { tools: selected.tools.join(', ') })
                  : t('toolPresets.summaryEmpty')}
              </p>
            </div>
          ) : (
            <ConfigEmptyState>
              {loaded === null
                ? t('i18n.loading')
                : draft.length === 0
                  ? t('toolPresets.emptyNew')
                  : t('toolPresets.empty')}
            </ConfigEmptyState>
          )}
        </ConfigDetail>
      </ConfigSplitView>

      <ConfigFooter
        status={
          error ? (
            <ConfigFooterStatus summary={error} tone="error" />
          ) : savedOk && !dirty ? (
            <ConfigFooterStatus summary={t('i18n.saved')} />
          ) : null
        }
      >
        {selected && (
          <ConfigButton
            variant="danger"
            onClick={deleteSelected}
            onBlur={() => setConfirmingDelete(false)}
          >
            {confirmingDelete ? t('toolPresets.deleteConfirm') : t('toolPresets.delete')}
          </ConfigButton>
        )}
        <ConfigButton variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? t('toolPresets.saving') : t('toolPresets.save')}
        </ConfigButton>
      </ConfigFooter>
    </ConfigPanelShell>
  );
}
