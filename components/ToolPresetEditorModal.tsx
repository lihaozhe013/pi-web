'use client';

import { useEffect, useRef, useState } from 'react';
import { openStackedDialog } from '@/lib/stacked-dialog';
import { useI18n } from '@/hooks/useI18n';
import type { ToolEntry } from '@/lib/tool-presets';
import {
  CANONICAL_CODING_TOOLS,
  CUSTOM_TOOL_PRESET_MAX_COUNT,
  CUSTOM_TOOL_PRESET_TOOLS,
  customPresetNameError,
  makeCustomToolPresetId,
  type CustomToolPreset,
  type CustomToolPresetDocument
} from '@/lib/custom-tool-presets-shared';

type Translate = ReturnType<typeof useI18n>['t'];

interface Props {
  open: boolean;
  /** The saved presets the draft starts from; left alone until Save. */
  presets: CustomToolPreset[];
  /** Loaded tool definitions, for descriptions and the detail summary. */
  tools: ToolEntry[] | null;
  onSave: (document: CustomToolPresetDocument) => Promise<void>;
  onClose: () => void;
}

/** The shell tool is stored canonically as `bash` and shown as one "shell" entry. */
const SHELL_TOOL = 'bash';

const START_FROM: { preset: 'read-only' | 'default' | 'full' }[] = [
  { preset: 'read-only' },
  { preset: 'default' },
  { preset: 'full' }
];

const START_TOOLS: Record<'read-only' | 'default' | 'full', readonly string[]> = {
  'read-only': ['read', 'grep', 'find', 'ls'],
  default: ['read', SHELL_TOOL, 'edit', 'write'],
  full: CUSTOM_TOOL_PRESET_TOOLS
};

function toolDescription(tool: string, tools: ToolEntry[] | null, t: Translate): string {
  const key = `toolPresets.tool.${tool}`;
  const localized = t(key);
  if (localized !== key) return localized;
  // Fall back to the loaded definition's own description, trimmed to one line.
  const entry = tools?.find((candidate) => candidate.name === tool);
  if (entry?.description) {
    const line = entry.description.trim().split('\n')[0];
    if (line) return line;
  }
  return '';
}

/**
 * The custom tool preset editor: a modal over the conversation that manages the
 * user's preset list as one draft. Changes stay local until Save replaces the
 * whole server-side list; Escape, the backdrop, and Cancel discard them.
 */
export function ToolPresetEditorModal({ open, presets, tools, onSave, onClose }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<CustomToolPreset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // A fresh draft each time the editor opens; it never writes back until Save.
  useEffect(() => {
    if (!open) return;
    setDraft(presets.map((preset) => ({ ...preset, tools: [...preset.tools] })));
    setSelectedId(presets[0]?.id ?? null);
    setConfirmingDelete(false);
    setError(null);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the draft is a snapshot of the list as the editor opened.
  }, [open]);

  useEffect(
    () => (open ? openStackedDialog(document, dialogRef.current, onClose) : undefined),
    [open, onClose]
  );

  const selected = draft.find((preset) => preset.id === selectedId) ?? null;

  if (!open) return null;

  const updateSelected = (changes: Partial<CustomToolPreset>) => {
    if (!selected) return;
    setDraft((current) =>
      current.map((preset) => (preset.id === selected.id ? { ...preset, ...changes } : preset))
    );
  };

  const toggleTool = (tool: string) => {
    if (!selected) return;
    const has = selected.tools.includes(tool);
    const tools2 = has
      ? selected.tools.filter((name) => name !== tool)
      : CUSTOM_TOOL_PRESET_TOOLS.filter((name) => selected.tools.includes(name) || name === tool);
    updateSelected({ tools: tools2 });
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
      await onSave({ version: 1, presets: draft });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const atLimit = draft.length >= CUSTOM_TOOL_PRESET_MAX_COUNT;
  const nameError = selected
    ? customPresetNameError(draft, selected.id, selected.name)
    : undefined;

  return (
    <div
      role="presentation"
      className="tool-preset-editor-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tool-preset-editor-title"
        tabIndex={-1}
        className="tool-preset-editor"
      >
        <header className="tool-preset-editor-header">
          <h2 id="tool-preset-editor-title">{t('toolPresets.title')}</h2>
          <p>{t('toolPresets.description')}</p>
          <button
            type="button"
            className="tool-preset-editor-close"
            aria-label={t('toolPresets.close')}
            onClick={onClose}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="tool-preset-editor-body">
          <nav className="tool-preset-list" aria-label={t('toolPresets.list')}>
            {draft.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`tool-preset-item${preset.id === selectedId ? ' selected' : ''}`}
                aria-pressed={preset.id === selectedId}
                onClick={() => {
                  setSelectedId(preset.id);
                  setConfirmingDelete(false);
                }}
              >
                <span className="tool-preset-item-name">{preset.name || t('toolPresets.untitled')}</span>
                <span className="tool-preset-item-count">
                  {t('chat.toolCount', { count: preset.tools.length })}
                </span>
              </button>
            ))}
            <button
              type="button"
              className="tool-preset-add"
              onClick={addPreset}
              disabled={atLimit}
              title={atLimit ? t('toolPresets.limitReached', { count: CUSTOM_TOOL_PRESET_MAX_COUNT }) : undefined}
            >
              + {t('toolPresets.newPreset')}
            </button>
          </nav>

          <section className="tool-preset-form" aria-label={t('toolPresets.editor')}>
            {selected ? (
              <>
                <label className="tool-preset-field">
                  <span>{t('toolPresets.name')}</span>
                  <input
                    type="text"
                    value={selected.name}
                    maxLength={60}
                    onChange={(event) => updateSelected({ name: event.target.value })}
                    aria-invalid={nameError !== undefined}
                  />
                  {nameError && <span className="tool-preset-field-error">{t(`toolPresets.errorName.${nameError}`)}</span>}
                </label>

                <div className="tool-preset-start">
                  <span>{t('toolPresets.startFrom')}</span>
                  <div>
                    {START_FROM.map(({ preset }) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => updateSelected({ tools: [...START_TOOLS[preset]] })}
                      >
                        {t(`toolPresets.start.${preset}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <fieldset className="tool-preset-tools">
                  <legend>{t('toolPresets.tools')}</legend>
                  {CANONICAL_CODING_TOOLS.map((tool) => {
                    const checked = selected.tools.includes(tool);
                    const description = toolDescription(tool, tools, t);
                    return (
                      <label key={tool} className="tool-preset-tool">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTool(tool)}
                        />
                        <code>{tool === SHELL_TOOL ? 'shell' : tool}</code>
                        {description && <span>{description}</span>}
                      </label>
                    );
                  })}
                </fieldset>

                <p className="tool-preset-summary">
                  {selected.tools.length > 0
                    ? t('toolPresets.summary', { tools: selected.tools.join(', ') })
                    : t('toolPresets.summaryEmpty')}
                </p>

                <div className="tool-preset-delete-row">
                  <button
                    type="button"
                    className="tool-preset-delete"
                    onClick={deleteSelected}
                    onBlur={() => setConfirmingDelete(false)}
                  >
                    {confirmingDelete ? t('toolPresets.deleteConfirm') : t('toolPresets.delete')}
                  </button>
                </div>
              </>
            ) : (
              <div className="tool-preset-empty">{t('toolPresets.empty')}</div>
            )}
          </section>
        </div>

        <footer className="tool-preset-editor-footer">
          {error && (
            <p role="alert" className="tool-preset-editor-error">
              {error}
            </p>
          )}
          <div className="tool-preset-editor-actions">
            <button type="button" onClick={onClose} disabled={saving}>
              {t('toolPresets.cancel')}
            </button>
            <button
              type="button"
              className="tool-preset-save"
              onClick={save}
              disabled={saving}
            >
              {saving ? t('toolPresets.saving') : t('toolPresets.save')}
            </button>
          </div>
        </footer>
      </div>
      <style>{`
        .tool-preset-editor-backdrop {
          position: fixed;
          inset: 0;
          z-index: 300;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: color-mix(in srgb, var(--bg) 60%, transparent);
        }
        .tool-preset-editor {
          display: flex;
          flex-direction: column;
          width: min(680px, 100%);
          max-height: min(72dvh, 640px);
          background: var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: 12px;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
          overflow: hidden;
        }
        .tool-preset-editor-header {
          position: relative;
          padding: 14px 18px 12px;
          border-bottom: 1px solid var(--border);
        }
        .tool-preset-editor-header h2 {
          margin: 0;
          font-size: 14px;
          font-weight: 650;
          color: var(--text);
        }
        .tool-preset-editor-header p {
          margin: 4px 0 0;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.5;
        }
        .tool-preset-editor-close {
          position: absolute;
          top: 12px;
          right: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border: none;
          border-radius: 7px;
          background: none;
          color: var(--text-muted);
          cursor: pointer;
        }
        .tool-preset-editor-close:hover {
          background: var(--bg-hover);
          color: var(--text);
        }
        .tool-preset-editor-body {
          display: grid;
          grid-template-columns: 180px minmax(0, 1fr);
          min-height: 0;
          flex: 1;
        }
        .tool-preset-list,
        .tool-preset-form {
          min-height: 0;
          overflow: auto;
        }
        .tool-preset-list {
          display: flex;
          flex-direction: column;
          padding: 8px;
          gap: 2px;
          border-right: 1px solid var(--border);
          background: color-mix(in srgb, var(--bg-panel) 94%, var(--bg));
        }
        .tool-preset-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          width: 100%;
          padding: 7px 10px;
          border: none;
          border-radius: 8px;
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 12px;
          text-align: left;
        }
        .tool-preset-item:hover {
          background: var(--bg-hover);
          color: var(--text);
        }
        .tool-preset-item.selected {
          background: var(--bg-selected);
          color: var(--text);
          font-weight: 600;
        }
        .tool-preset-item-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tool-preset-item-count {
          flex-shrink: 0;
          color: var(--text-dim);
          font-size: 10px;
          font-weight: 400;
        }
        .tool-preset-add {
          margin-top: 4px;
          padding: 7px 10px;
          border: none;
          border-radius: 8px;
          background: none;
          color: var(--accent);
          cursor: pointer;
          font-size: 12px;
          text-align: left;
        }
        .tool-preset-add:hover:not(:disabled) {
          background: var(--bg-hover);
        }
        .tool-preset-add:disabled {
          color: var(--text-dim);
          cursor: not-allowed;
        }
        .tool-preset-form {
          padding: 14px 18px 16px;
        }
        .tool-preset-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
          margin-bottom: 14px;
        }
        .tool-preset-field > span {
          color: var(--text-dim);
          font-size: 11px;
          font-weight: 600;
        }
        .tool-preset-field input[type='text'] {
          width: 100%;
          padding: 7px 10px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg);
          color: var(--text);
          font-size: 13px;
        }
        .tool-preset-field input[type='text']:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: -1px;
        }
        .tool-preset-field input[aria-invalid='true'] {
          border-color: #ef4444;
        }
        .tool-preset-field-error {
          color: #ef4444;
          font-size: 11px;
        }
        .tool-preset-start {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 14px;
        }
        .tool-preset-start > span {
          color: var(--text-dim);
          font-size: 11px;
          font-weight: 600;
        }
        .tool-preset-start > div {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .tool-preset-start button {
          padding: 4px 10px;
          border: 1px solid var(--border);
          border-radius: 999px;
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
        }
        .tool-preset-start button:hover {
          background: var(--bg-hover);
          color: var(--text);
        }
        .tool-preset-tools {
          margin: 0 0 10px;
          padding: 0;
          border: none;
        }
        .tool-preset-tools legend {
          margin-bottom: 7px;
          padding: 0;
          color: var(--text-dim);
          font-size: 11px;
          font-weight: 600;
        }
        .tool-preset-tool {
          display: flex;
          align-items: baseline;
          gap: 8px;
          padding: 6px 0;
          border-bottom: 1px solid var(--border);
          cursor: pointer;
          font-size: 12px;
          line-height: 1.45;
        }
        .tool-preset-tool:last-child {
          border-bottom: none;
        }
        .tool-preset-tool input[type='checkbox'] {
          flex-shrink: 0;
          width: 13px;
          height: 13px;
          accent-color: var(--accent);
        }
        .tool-preset-tool input[type='checkbox']:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .tool-preset-tool code {
          flex-shrink: 0;
          min-width: 52px;
          color: var(--text);
          font-size: 11px;
          font-weight: 600;
        }
        .tool-preset-tool span {
          min-width: 0;
          color: var(--text-muted);
        }
        .tool-preset-summary {
          margin: 0 0 12px;
          color: var(--text-dim);
          font-size: 11px;
          overflow-wrap: anywhere;
        }
        .tool-preset-delete-row {
          display: flex;
          justify-content: flex-end;
        }
        .tool-preset-delete {
          padding: 4px 10px;
          border: none;
          border-radius: 7px;
          background: none;
          color: #ef4444;
          cursor: pointer;
          font-size: 11px;
        }
        .tool-preset-delete:hover {
          background: rgba(239, 68, 68, 0.1);
        }
        .tool-preset-empty {
          padding: 24px 0;
          color: var(--text-muted);
          font-size: 12px;
          font-style: italic;
        }
        .tool-preset-editor-footer {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 18px 12px;
          border-top: 1px solid var(--border);
        }
        .tool-preset-editor-error {
          flex: 1;
          min-width: 0;
          margin: 0;
          color: #ef4444;
          font-size: 11px;
          overflow-wrap: anywhere;
        }
        .tool-preset-editor-actions {
          display: flex;
          flex: 1;
          justify-content: flex-end;
          gap: 8px;
        }
        .tool-preset-editor-error + .tool-preset-editor-actions {
          flex: unset;
        }
        .tool-preset-editor-actions button {
          padding: 6px 14px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 12px;
        }
        .tool-preset-editor-actions button:hover:not(:disabled) {
          background: var(--bg-hover);
          color: var(--text);
        }
        .tool-preset-editor-actions .tool-preset-save {
          background: var(--accent);
          border-color: var(--accent);
          color: var(--bg);
          font-weight: 600;
        }
        .tool-preset-editor-actions .tool-preset-save:hover:not(:disabled) {
          background: var(--accent);
          color: var(--bg);
          opacity: 0.9;
        }
        .tool-preset-editor-actions button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        @media (max-width: 640px) {
          .tool-preset-editor-backdrop {
            padding: 12px;
          }
          .tool-preset-editor-body {
            grid-template-columns: 132px minmax(0, 1fr);
          }
          .tool-preset-form {
            padding: 12px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .tool-preset-editor,
          .tool-preset-editor * {
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}
