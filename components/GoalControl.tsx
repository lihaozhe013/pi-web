'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GOAL_LIMITS } from '@/lib/goal-policy';
import {
  canEditObjective,
  goalActionLabelKey,
  goalCommand,
  goalStatusLabelKey,
  isGoalRunning,
  type GoalSnapshot,
  type GoalStatus
} from '@/lib/goal-state';
import { useI18n } from '@/hooks/useI18n';

/** The statuses a person can choose; a blocked goal resumes as active. */
type DraftStatus = Extract<GoalStatus, 'active' | 'paused' | 'completed'>;
const DRAFT_STATUSES: readonly DraftStatus[] = ['active', 'paused', 'completed'];

/** Known stop codes are translated; free-form model evidence is shown as written. */
function reasonText(reason: string, t: (key: string) => string): string {
  const key = `chat.goalReason.${reason}`;
  const translated = t(key);
  return translated === key ? reason : translated;
}

function initialDraft(goal: GoalSnapshot | undefined): DraftStatus {
  if (!goal) return 'active';
  if (goal.status === 'active') return 'active';
  if (goal.status === 'paused') return 'paused';
  if (goal.status === 'completed') return 'completed';
  // Blocked goals wait for the user, so the useful next step is to run again.
  return 'active';
}

/**
 * The goal entry beside the model picker: a quiet state-bearing button that opens
 * the one dialog where a goal is written and its status changed. The run itself
 * belongs to the agent; this control only sends commands and stops a run on request.
 */
export function GoalControl({
  goal,
  running,
  busy,
  onCommand,
  onStop
}: {
  goal?: GoalSnapshot;
  /** The selected session is streaming: commands wait, but the run can be stopped. */
  running: boolean;
  /** Any work is in flight, including shell commands; goal changes wait for idle. */
  busy: boolean;
  onCommand: (command: string) => void;
  onStop: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [objective, setObjective] = useState('');
  const [status, setStatus] = useState<DraftStatus>('active');
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusFieldRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const objectiveId = useId();
  const hintId = useId();
  const errorId = useId();

  const editable = canEditObjective(goal) && !busy;
  const command = goalCommand(goal, { objective, status });
  const statusLabel = goal ? t(goalStatusLabelKey(goal.status)) : null;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    // Land on the field a person came to change, or on the dialog when it is read-only.
    // The target is chosen when the dialog opens, so a status refresh never moves focus.
    (focusFieldRef.current ? textareaRef.current : dialogRef.current)?.focus();
  }, [open]);

  const openDialog = () => {
    focusFieldRef.current = canEditObjective(goal) && !busy;
    setObjective(goal?.objective ?? '');
    setStatus(initialDraft(goal));
    setError(null);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const apply = () => {
    if (!objective.trim()) {
      setError(t('chat.goalObjectiveRequired'));
      textareaRef.current?.focus();
      return;
    }
    if (!command) return;
    onCommand(command);
    close();
  };

  const validateObjective = () => {
    if (!objective.trim()) setError(t('chat.goalObjectiveRequired'));
  };

  // The trigger stays mounted while the dialog is open, so closing can return focus to it.
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="goal-trigger"
      data-state={isGoalRunning(goal) ? 'active' : 'idle'}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={goal ? `${t('chat.goal')}: ${statusLabel}. ${goal.objective}` : t('chat.goal')}
      title={goal ? `${goal.objective} · ${statusLabel}` : t('chat.goalAction')}
      onClick={openDialog}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
      <span>{t('chat.goal')}</span>
      {statusLabel && <span className="goal-trigger-state">{statusLabel}</span>}
    </button>
  );

  if (!open || !mounted) return trigger;

  return (
    <>
      {trigger}
      {createPortal(
        <div
          className="goal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
              return;
            }
            if (event.key !== 'Tab') return;
            const controls = Array.from(
              dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [href]'
              ) ?? []
            );
            const first = controls[0];
            const last = controls.at(-1);
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <div
            ref={dialogRef}
            className="goal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
          >
            <header className="goal-dialog-header">
              <div>
                <h2 id={titleId}>{t('chat.goal')}</h2>
                <p id={descriptionId}>{t('chat.goalDialogDescription')}</p>
              </div>
              <button
                type="button"
                className="goal-close"
                onClick={close}
                aria-label={t('i18n.close')}
                title={t('i18n.close')}
              >
                ×
              </button>
            </header>

            {goal && (
              <div className="goal-current" data-state={goal.status}>
                <span className="goal-current-status">{statusLabel}</span>
                <span className="goal-current-meta">
                  {t('chat.goalTurns', {
                    used: goal.continuations,
                    max: GOAL_LIMITS.maxContinuations
                  })}
                </span>
                {goal.reason && <p className="goal-current-reason">{reasonText(goal.reason, t)}</p>}
              </div>
            )}

            <div className="goal-field">
              <label htmlFor={objectiveId}>{t('chat.goalObjective')}</label>
              <textarea
                id={objectiveId}
                ref={textareaRef}
                value={objective}
                disabled={!editable}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                maxLength={4000}
                rows={3}
                onChange={(event) => {
                  setObjective(event.target.value);
                  if (error) setError(null);
                }}
                onBlur={validateObjective}
              />
              <p className="goal-hint" id={hintId}>
                {editable ? t('chat.goalObjectiveHint') : t('chat.goalLocked')}
              </p>
              {error && (
                <p className="goal-error" id={errorId} role="alert">
                  {error}
                </p>
              )}
            </div>

            {goal && (
              <fieldset className="goal-status-fieldset" disabled={busy}>
                <legend>{t('chat.goalStatus')}</legend>
                <div className="goal-status-options">
                  {DRAFT_STATUSES.map((value) => (
                    <label key={value} className="goal-status-option">
                      <input
                        type="radio"
                        name={`${objectiveId}-status`}
                        value={value}
                        checked={status === value}
                        onChange={() => setStatus(value)}
                      />
                      <span>
                        {t(`chat.goalStatusOption.${value}`)}
                        <small>{t(`chat.goalStatusOption.${value}Hint`)}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <p className="goal-hint">
              {t('chat.goalLimits', {
                turns: GOAL_LIMITS.maxContinuations,
                tokens: GOAL_LIMITS.maxTokens.toLocaleString('en-US'),
                minutes: GOAL_LIMITS.maxElapsedMs / 60_000
              })}
            </p>

            {busy && goal && <p className="goal-hint">{t('chat.goalBusy')}</p>}

            <div className="goal-actions">
              {running && goal?.status === 'active' && (
                <button
                  type="button"
                  className="goal-button"
                  onClick={() => {
                    onStop();
                    close();
                  }}
                >
                  {t('chat.goalStopRun')}
                </button>
              )}
              <span className="goal-actions-spacer" />
              {goal && goal.status !== 'active' && (
                <button
                  type="button"
                  className="goal-button goal-button-quiet"
                  disabled={busy}
                  onClick={() => {
                    onCommand('/goal clear');
                    close();
                  }}
                >
                  {t('chat.goalClear')}
                </button>
              )}
              <button
                type="button"
                className="goal-button goal-button-primary"
                disabled={busy || (objective.trim() !== '' && !command)}
                onClick={apply}
              >
                {t(goalActionLabelKey(goal, { objective, status }))}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
