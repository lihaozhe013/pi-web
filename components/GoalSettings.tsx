'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  GOAL_LIMITS,
  GOAL_LIMIT_BOUNDS,
  goalLimitsFromFields,
  type GoalLimits
} from '@/lib/goal-policy';
import { useI18n } from '@/hooks/useI18n';
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailGrid,
  ConfigDetailGridRow,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigFooter,
  ConfigFooterStatus,
  ConfigPanelShell
} from './SettingsUi';

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

function isGoalLimits(value: unknown): value is GoalLimits {
  if (typeof value !== 'object' || value === null) return false;
  const limits = value as Record<string, unknown>;
  return (
    typeof limits.maxContinuations === 'number' &&
    typeof limits.maxTokens === 'number' &&
    typeof limits.maxElapsedMs === 'number'
  );
}

/**
 * Settings › Goal: the depth a new autonomous goal starts with, stored as the
 * global `piWebGoal` key in settings.json. A goal can still pick its own depth
 * in the Goal dialog, and a running goal keeps the depth it started with.
 */
export function GoalSettings({ embedded, onClose }: { embedded: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [fields, setFields] = useState<LimitFields>(() => fieldsOf(GOAL_LIMITS));
  const [stored, setStored] = useState<GoalLimits>(GOAL_LIMITS);
  const [loadError, setLoadError] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const depthHintId = useId();
  const errorId = useId();
  // Typing while the stored value loads must not be undone by the answer.
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/goal/settings')
      .then(async (response) => {
        const data: unknown = await response.json();
        if (!response.ok || !isGoalLimits(data)) throw new Error('failed');
        if (cancelled) return;
        setStored(data);
        if (!touched.current) setFields(fieldsOf(data));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const limits = goalLimitsFromFields(fields);
  const changed =
    limits !== undefined &&
    (limits.maxContinuations !== stored.maxContinuations ||
      limits.maxTokens !== stored.maxTokens ||
      limits.maxElapsedMs !== stored.maxElapsedMs);

  const save = async (next: GoalLimits) => {
    setSaveState('saving');
    try {
      const response = await fetch('/api/goal/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next)
      });
      const data: unknown = await response.json();
      if (!response.ok || !isGoalLimits(data)) throw new Error('failed');
      setStored(data);
      setFields(fieldsOf(data));
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const setField = (key: keyof LimitFields, value: string) => {
    touched.current = true;
    setFields((current) => ({ ...current, [key]: value }));
    setSaveState('idle');
  };

  const status =
    saveState === 'saving'
      ? t('i18n.saving')
      : saveState === 'saved'
        ? t('settings.goalSaved')
        : saveState === 'error'
          ? t('settings.goalSaveFailed')
          : loadError
            ? t('settings.goalLoadFailed')
            : undefined;

  return (
    <ConfigPanelShell
      embedded={embedded}
      title={t('settings.goal')}
      subtitle={t('settings.goalDescription')}
      closeLabel={t('i18n.close')}
      onClose={onClose}
    >
      <ConfigDetail>
        <ConfigDetailStack>
          <ConfigDetailHeader>
            <ConfigDetailHeaderInfo>
              <ConfigDetailTitle>
                <span id="settings-goal-depth">{t('settings.goalDepth')}</span>
              </ConfigDetailTitle>
            </ConfigDetailHeaderInfo>
          </ConfigDetailHeader>

          <p className="mcp-config-line">{t('settings.goalDescription')}</p>

          <ConfigDetailGrid>
            <ConfigDetailGridRow label={t('settings.goalTurns')} tone="plain">
              <input
                className="mcp-add-input goal-limit-input"
                type="number"
                inputMode="numeric"
                min={GOAL_LIMIT_BOUNDS.maxContinuations.min}
                max={GOAL_LIMIT_BOUNDS.maxContinuations.max}
                step={1}
                aria-label={t('settings.goalTurns')}
                aria-describedby={limits ? depthHintId : `${depthHintId} ${errorId}`}
                aria-invalid={limits ? undefined : true}
                value={fields.turns}
                onChange={(event) => setField('turns', event.target.value)}
              />
            </ConfigDetailGridRow>
            <ConfigDetailGridRow label={t('settings.goalTokens')} tone="plain">
              <input
                className="mcp-add-input goal-limit-input"
                type="number"
                inputMode="numeric"
                min={GOAL_LIMIT_BOUNDS.maxTokens.min}
                max={GOAL_LIMIT_BOUNDS.maxTokens.max}
                step={10_000}
                aria-label={t('settings.goalTokens')}
                aria-describedby={limits ? depthHintId : `${depthHintId} ${errorId}`}
                aria-invalid={limits ? undefined : true}
                value={fields.tokens}
                onChange={(event) => setField('tokens', event.target.value)}
              />
            </ConfigDetailGridRow>
            <ConfigDetailGridRow label={t('settings.goalMinutes')} tone="plain">
              <div className="goal-limit-row">
                <input
                  className="mcp-add-input goal-limit-input"
                  type="number"
                  inputMode="numeric"
                  min={GOAL_LIMIT_BOUNDS.maxElapsedMs.min / 60_000}
                  max={GOAL_LIMIT_BOUNDS.maxElapsedMs.max / 60_000}
                  step={1}
                  aria-label={t('settings.goalMinutes')}
                  aria-describedby={limits ? depthHintId : `${depthHintId} ${errorId}`}
                  aria-invalid={limits ? undefined : true}
                  value={fields.minutes}
                  onChange={(event) => setField('minutes', event.target.value)}
                />
                <span className="mcp-config-line">{t('settings.goalMinutesUnit')}</span>
              </div>
            </ConfigDetailGridRow>
          </ConfigDetailGrid>

          {!limits && (
            <p className="mcp-config-line is-error" id={errorId} role="alert">
              {t('settings.goalInvalid')}
            </p>
          )}
          <p className="mcp-config-line" id={depthHintId}>
            {t('settings.goalDialogNote')} {t('settings.goalBetweenRuns')}
          </p>
        </ConfigDetailStack>
        <ConfigFooter status={status ? <ConfigFooterStatus summary={status} /> : undefined}>
          <ConfigButton disabled={saveState === 'saving'} onClick={() => void save(GOAL_LIMITS)}>
            {t('settings.goalReset')}
          </ConfigButton>
          <ConfigButton
            variant="primary"
            disabled={!changed || saveState === 'saving'}
            onClick={() => {
              if (limits) void save(limits);
            }}
          >
            {t('i18n.save')}
          </ConfigButton>
        </ConfigFooter>
      </ConfigDetail>
    </ConfigPanelShell>
  );
}
