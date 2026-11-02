'use client';

import { useState, type FormEvent } from 'react';
import { useI18n } from '@/hooks/useI18n';
import type { TaskConfig } from '@/lib/tasks/types';
import { ModelSelector, type ModelSelectorOption } from './ModelSelector';
import { SessionModal } from './SessionModal';

export interface QueueSettingsDialogProps {
  config: TaskConfig;
  modelOptions: ModelSelectorOption[];
  /** The CLI's own model, shown on the "default" row of the selector. */
  defaultModelLabel: string | null;
  onClose: () => void;
  /** Reload the board so a task form's "use queue default" reads the new value. */
  onSaved: () => void;
}

const MINUTE_MS = 60_000;

function minutesFrom(ms: number): string {
  const minutes = ms / MINUTE_MS;
  return String(Number.isInteger(minutes) ? minutes : Number(minutes.toFixed(2)));
}

/**
 * One page for the defaults a task inherits: the model, the two timeouts, the
 * verification commands, the question policy, and the commit choice. The same
 * values appear as "use queue default" in a task's form, so they have to be
 * readable and editable somewhere the board already opens.
 */
export function QueueSettingsDialog({
  config,
  modelOptions,
  defaultModelLabel,
  onClose,
  onSaved
}: QueueSettingsDialogProps) {
  const { t } = useI18n();
  const [model, setModel] = useState<{ provider: string; modelId: string } | null>(config.model);
  const [taskMinutes, setTaskMinutes] = useState(() => minutesFrom(config.taskTimeoutMs));
  const [verifyMinutes, setVerifyMinutes] = useState(() => minutesFrom(config.verifyTimeoutMs));
  const [commands, setCommands] = useState(() => config.verifyCommands.join('\n'));
  const [allowAskUser, setAllowAskUser] = useState(config.allowAskUser);
  const [autoCommit, setAutoCommit] = useState(config.autoCommit);
  const [commitMessage, setCommitMessage] = useState(config.commitMessage);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const parseMinutes = (value: string): number | null => {
    const minutes = Number(value.trim());
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return Math.round(minutes * MINUTE_MS);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const taskTimeoutMs = parseMinutes(taskMinutes);
    const verifyTimeoutMs = parseMinutes(verifyMinutes);
    if (taskTimeoutMs === null || verifyTimeoutMs === null) {
      setProblem(t('tasks.timeoutInvalid'));
      return;
    }
    const template = commitMessage.trim();
    if (!template) {
      setProblem(t('tasks.commitMessageRequired'));
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      const response = await fetch('/api/tasks/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          taskTimeoutMs,
          verifyTimeoutMs,
          verifyCommands: commands
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          allowAskUser,
          autoCommit,
          commitMessage: template
        })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      onSaved();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setSaving(false);
    }
  };

  return (
    <SessionModal
      title={t('tasks.queueDefaults')}
      maxWidth={520}
      icon={
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h8M16 18h4" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="14" cy="18" r="2" />
        </svg>
      }
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      {/* The form states its own problems under the field, not in a browser tooltip. */}
      <form className="queue-settings" noValidate onSubmit={(event) => void save(event)}>
        <p className="queue-settings-intro">{t('tasks.queueDefaultsHint')}</p>

        <section className="queue-settings-section">
          <h3>{t('tasks.model')}</h3>
          {modelOptions.length > 0 ? (
            <div className="queue-settings-field">
              <ModelSelector
                options={modelOptions}
                value={model}
                onChange={(provider, modelId) => setModel({ provider, modelId })}
                onClear={() => setModel(null)}
                emptyLabel={
                  defaultModelLabel
                    ? `${t('tasks.modelDefault')}: ${defaultModelLabel}`
                    : t('tasks.modelDefault')
                }
                ariaLabel={t('tasks.model')}
                variant="field"
                placement="auto"
              />
              <span className="task-hint">{t('tasks.modelHint')}</span>
            </div>
          ) : (
            <p className="task-hint">{t('tasks.modelUnavailable')}</p>
          )}
        </section>

        <section className="queue-settings-section">
          <h3>{t('tasks.limits')}</h3>
          <label className="task-field">
            <span>{t('tasks.taskTimeout')}</span>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={taskMinutes}
              onChange={(event) => setTaskMinutes(event.target.value)}
            />
            <span className="task-hint">{t('tasks.taskTimeoutHint')}</span>
          </label>
          <label className="task-field">
            <span>{t('tasks.verifyTimeout')}</span>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={verifyMinutes}
              onChange={(event) => setVerifyMinutes(event.target.value)}
            />
            <span className="task-hint">{t('tasks.verifyTimeoutHint')}</span>
          </label>
        </section>

        <section className="queue-settings-section">
          <h3>{t('tasks.verificationDefaults')}</h3>
          <label className="task-field">
            <span className="sr-only">{t('tasks.verifyCommandsLabel')}</span>
            <textarea
              className="task-mono"
              rows={3}
              placeholder={t('tasks.verifyCommandsHint')}
              value={commands}
              onChange={(event) => setCommands(event.target.value)}
            />
            <span className="task-hint">{t('tasks.verificationDefaultsHint')}</span>
          </label>
        </section>

        <section className="queue-settings-section">
          <h3>{t('tasks.defaults')}</h3>
          <label className="task-field">
            <span>{t('tasks.allowAskUser')}</span>
            <select
              value={allowAskUser ? 'yes' : 'no'}
              onChange={(event) => setAllowAskUser(event.target.value === 'yes')}
            >
              <option value="no">{t('tasks.disabled')}</option>
              <option value="yes">{t('tasks.enabled')}</option>
            </select>
          </label>
          <label className="task-field">
            <span>{t('tasks.autoCommit')}</span>
            <select
              value={autoCommit ? 'yes' : 'no'}
              onChange={(event) => setAutoCommit(event.target.value === 'yes')}
            >
              <option value="no">{t('tasks.disabled')}</option>
              <option value="yes">{t('tasks.enabled')}</option>
            </select>
          </label>
          <label className="task-field">
            <span>{t('tasks.commitMessage')}</span>
            <input
              className="task-mono"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
            <span className="task-hint">{t('tasks.commitMessageHint')}</span>
          </label>
        </section>

        {problem && (
          <p className="task-field-error" role="alert">
            {problem}
          </p>
        )}

        <div className="queue-settings-actions">
          <button type="submit" className="task-control is-primary" disabled={saving}>
            {saving ? t('tasks.saving') : t('tasks.save')}
          </button>
          <button type="button" className="task-control" onClick={onClose} disabled={saving}>
            {t('tasks.cancel')}
          </button>
        </div>
      </form>
    </SessionModal>
  );
}
