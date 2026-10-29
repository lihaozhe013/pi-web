'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  GOAL_LIMITS,
  GOAL_LIMIT_PRESETS,
  goalLimitPresetOf,
  goalLimitsFromFields,
  type GoalLimits
} from '@/lib/goal-policy';
import {
  canEditObjective,
  effectiveGoalLimits,
  goalActionLabelKey,
  goalCommand,
  goalStatusLabelKey,
  type GoalSnapshot,
  type GoalStatus
} from '@/lib/goal-state';
import { useI18n } from '@/hooks/useI18n';

/** The statuses a person can choose; a blocked goal resumes as active. */
type DraftStatus = Extract<GoalStatus, 'active' | 'paused' | 'completed'>;
const DRAFT_STATUSES: readonly DraftStatus[] = ['active', 'paused', 'completed'];

interface LimitFields {
  turns: string;
  tokens: string;
  minutes: string;
}

function fieldsOf(limits: GoalLimits): LimitFields {
  return {
    turns: String(limits.maxContinuations),
    tokens: String(limits.maxTokens),
    minutes: String(limits.maxElapsedMs / 60_000)
  };
}

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
 * The goal inside the composer hub: where a goal is written and its status and
 * depth changed. The run itself belongs to the agent; this section only sends
 * commands and stops a run on request. It owns no dialog chrome — the hub does —
 * and it mounts fresh each time the hub opens, so a draft never outlives a visit.
 */
export function GoalSection({
  goal,
  running,
  busy,
  focusObjective,
  onCommand,
  onStop,
  onDone
}: {
  goal?: GoalSnapshot;
  /** The selected session is streaming: commands wait, but the run can be stopped. */
  running: boolean;
  /** Any work is in flight, including shell commands; goal changes wait for idle. */
  busy: boolean;
  /** The hub opened with the goal section as its subject. */
  focusObjective: boolean;
  onCommand: (command: string) => void;
  onStop: () => void;
  /** A command was sent or the goal was cleared; the hub closes. */
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [objective, setObjective] = useState(() => goal?.objective ?? '');
  const [status, setStatus] = useState<DraftStatus>(() => initialDraft(goal));
  const [fields, setFields] = useState<LimitFields>(() =>
    fieldsOf(goal ? effectiveGoalLimits(goal, GOAL_LIMITS) : GOAL_LIMITS)
  );
  const [defaultLimits, setDefaultLimits] = useState<GoalLimits | null>(null);
  const [limitsTouched, setLimitsTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitsError, setLimitsError] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const objectiveId = useId();
  const hintId = useId();
  const errorId = useId();
  const limitsId = useId();
  const limitsHintId = useId();
  const limitsErrorId = useId();

  const editable = canEditObjective(goal) && !busy;
  const limits = goalLimitsFromFields(fields);
  const preset = limits ? goalLimitPresetOf(limits) : undefined;
  const command = goalCommand(
    goal,
    { objective, status, ...(limits ? { limits } : {}) },
    defaultLimits ?? GOAL_LIMITS
  );
  const statusLabel = goal ? t(goalStatusLabelKey(goal.status)) : null;
  const currentLimits = effectiveGoalLimits(goal, defaultLimits ?? GOAL_LIMITS);

  // The stored default depth is what a new goal starts at; the section shows it
  // rather than making a person look the value up in Settings first.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/goal/settings')
      .then(async (response) => {
        const data: unknown = await response.json();
        if (!response.ok || typeof data !== 'object' || data === null) throw new Error('failed');
        const parsed = data as GoalLimits;
        if (!cancelled) setDefaultLimits(parsed);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Land on the field a person came to change. The target is chosen when the
  // section opens, so a status refresh never moves focus.
  useEffect(() => {
    if (focusObjective) textareaRef.current?.focus();
  }, [focusObjective]);

  // A new goal follows the stored default until the person changes the depth; a
  // goal saved before depth existed takes it too, the first time it is edited.
  useEffect(() => {
    if (limitsTouched || !defaultLimits) return;
    if (goal?.limits) return;
    setFields(fieldsOf(defaultLimits));
  }, [goal, limitsTouched, defaultLimits]);

  const apply = () => {
    if (!objective.trim()) {
      setError(t('chat.goalObjectiveRequired'));
      textareaRef.current?.focus();
      return;
    }
    if (!limits) {
      setLimitsError(true);
      return;
    }
    if (!command) return;
    onCommand(command);
    onDone();
  };

  const validateObjective = () => {
    if (!objective.trim()) setError(t('chat.goalObjectiveRequired'));
  };

  const setField = (key: keyof LimitFields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    setLimitsTouched(true);
    setLimitsError(false);
  };

  return (
    <>
      {goal && (
        <div className="goal-current" data-state={goal.status}>
          <span className="goal-current-status">{statusLabel}</span>
          <span className="goal-current-meta">
            {t('chat.goalTurns', {
              used: goal.continuations,
              max: currentLimits.maxContinuations
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

      <div className="goal-field">
        <span className="goal-label" id={limitsId}>
          {t('chat.goalDepth')}
        </span>
        <div className="goal-depth-presets" role="group" aria-labelledby={limitsId}>
          {GOAL_LIMIT_PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="goal-depth-preset"
              data-state={preset === option.id ? 'selected' : 'idle'}
              aria-pressed={preset === option.id}
              disabled={!editable}
              onClick={() => {
                setFields(fieldsOf(option.limits));
                setLimitsTouched(true);
                setLimitsError(false);
              }}
            >
              {t(`chat.goalDepthPreset.${option.id}`)}
            </button>
          ))}
        </div>
        <div className="goal-depth-fields">
          <label className="goal-depth-field">
            <span>{t('chat.goalDepthTurns')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              step={1}
              value={fields.turns}
              disabled={!editable}
              aria-invalid={limitsError ? true : undefined}
              aria-describedby={limitsError ? `${limitsHintId} ${limitsErrorId}` : limitsHintId}
              onChange={(event) => setField('turns', event.target.value)}
            />
          </label>
          <label className="goal-depth-field">
            <span>{t('chat.goalDepthTokens')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={10_000}
              max={5_000_000}
              step={10_000}
              value={fields.tokens}
              disabled={!editable}
              aria-invalid={limitsError ? true : undefined}
              aria-describedby={limitsError ? `${limitsHintId} ${limitsErrorId}` : limitsHintId}
              onChange={(event) => setField('tokens', event.target.value)}
            />
          </label>
          <label className="goal-depth-field">
            <span>{t('chat.goalDepthMinutes')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={480}
              step={1}
              value={fields.minutes}
              disabled={!editable}
              aria-invalid={limitsError ? true : undefined}
              aria-describedby={limitsError ? `${limitsHintId} ${limitsErrorId}` : limitsHintId}
              onChange={(event) => setField('minutes', event.target.value)}
            />
          </label>
        </div>
        {limitsError ? (
          <p className="goal-error" id={limitsErrorId} role="alert">
            {t('chat.goalDepthInvalid')}
          </p>
        ) : (
          <p className="goal-hint" id={limitsHintId}>
            {t('chat.goalLimits', {
              turns: limits?.maxContinuations ?? fields.turns,
              tokens: limits ? limits.maxTokens.toLocaleString('en-US') : fields.tokens,
              minutes: limits ? limits.maxElapsedMs / 60_000 : fields.minutes
            })}
          </p>
        )}
      </div>

      {busy && goal && <p className="goal-hint">{t('chat.goalBusy')}</p>}

      <div className="composer-hub-actions">
        {running && goal?.status === 'active' && (
          <button
            type="button"
            className="hub-button"
            onClick={() => {
              onStop();
              onDone();
            }}
          >
            {t('chat.goalStopRun')}
          </button>
        )}
        <span className="composer-hub-actions-spacer" />
        {goal && goal.status !== 'active' && (
          <button
            type="button"
            className="hub-button hub-button-quiet"
            disabled={busy}
            onClick={() => {
              onCommand('/goal clear');
              onDone();
            }}
          >
            {t('chat.goalClear')}
          </button>
        )}
        <button
          type="button"
          className="hub-button hub-button-primary"
          disabled={busy || !limits || (objective.trim() !== '' && !command)}
          onClick={apply}
        >
          {t(
            goalActionLabelKey(
              goal,
              { objective, status, ...(limits ? { limits } : {}) },
              defaultLimits ?? GOAL_LIMITS
            )
          )}
        </button>
      </div>
    </>
  );
}
