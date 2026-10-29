'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CompactResultInfo } from '@/hooks/useAgentSession';
import { useI18n } from '@/hooks/useI18n';
import { compactSummaryText } from '@/lib/compact-summary';
import {
  canEditObjective,
  goalStatusLabelKey,
  isGoalRunning,
  type GoalSnapshot
} from '@/lib/goal-state';
import { formatCompactCount } from '@/lib/session-stats-format';
import { GoalSection } from './GoalSection';

/** What the composer can say about the session's context window. */
export interface ContextUsageSummary {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

/**
 * One entry for the controls that act on the whole session instead of one prompt:
 * the goal the agent keeps working toward, and compaction of the context.
 *
 * Neither is a per-turn knob, so neither belongs in the always-visible footer.
 * The entry stays in the footer only as an opener — carrying the goal's state
 * word when a goal exists, because a goal that keeps working on its own is the
 * one state a person must be able to read without opening anything. Compaction
 * has no state worth a permanent slot: while it runs it reports in the run
 * status row above the composer, with every other thing the agent is doing.
 */
export function ComposerHub({
  goal,
  running,
  busy,
  iconOnly,
  onGoalCommand,
  onGoalStop,
  onCompact,
  onAbortCompaction,
  isCompacting,
  compactResult,
  contextUsage
}: {
  goal?: GoalSnapshot;
  /** The selected session is streaming. */
  running: boolean;
  /** Any work is in flight, including shell commands. */
  busy: boolean;
  /** The footer has no room for a word, so the entry is its icon alone. */
  iconOnly: boolean;
  onGoalCommand?: (command: string) => void;
  onGoalStop?: () => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactResult?: CompactResultInfo | null;
  contextUsage?: ContextUsageSummary | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const goalId = useId();
  const goalHintId = useId();
  const contextId = useId();
  const contextHintId = useId();
  const usageId = useId();
  const resultId = useId();

  const active = isGoalRunning(goal);
  const statusLabel = goal ? t(goalStatusLabelKey(goal.status)) : null;
  // A goal is the reason to open this: land on its objective, or on the dialog
  // when the goal cannot be edited while a run holds it.
  const focusObjective = canEditObjective(goal) && !busy;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    // The section focuses its own field, so the dialog only takes focus when the
    // goal is read-only; otherwise focus would move twice.
    if (!focusObjective) dialogRef.current?.focus();
  }, [open, focusObjective]);

  const label = goal ? t('chat.goal') : t('chat.more');

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="composer-hub-trigger"
      data-state={active ? 'active' : 'idle'}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={
        iconOnly ? (goal ? `${t('chat.goal')}: ${statusLabel}` : t('chat.hubTitle')) : undefined
      }
      title={
        goal ? `${t('chat.hubTitle')} · ${statusLabel}: ${goal.objective}` : t('chat.hubTitle')
      }
      onClick={() => setOpen(true)}
    >
      {goal ? (
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
      ) : (
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
          <circle cx="12" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </svg>
      )}
      {!iconOnly && <span className="composer-hub-trigger-label">{label}</span>}
      {statusLabel && <span className="composer-hub-trigger-state">{statusLabel}</span>}
    </button>
  );

  if (!open || !mounted) return trigger;

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const usageText =
    contextUsage &&
    contextUsage.contextWindow > 0 &&
    contextUsage.tokens !== null &&
    contextUsage.percent !== null
      ? t('chat.hubContextUsage', {
          window: formatCompactCount(contextUsage.contextWindow),
          percent: Math.round(contextUsage.percent)
        })
      : t('chat.hubContextUnknown');

  return (
    <>
      {trigger}
      {createPortal(
        <div
          className="composer-hub-backdrop"
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
            if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === dialogRef.current)
            ) {
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
            className="composer-hub-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <header className="composer-hub-header">
              <h2 id={titleId}>{t('chat.hubTitle')}</h2>
              <button
                type="button"
                className="composer-hub-close"
                onClick={close}
                aria-label={t('i18n.close')}
                title={t('i18n.close')}
              >
                ×
              </button>
            </header>

            <div className="composer-hub-body">
              {onGoalCommand && (
                <section
                  className="composer-hub-section"
                  aria-labelledby={goalId}
                  aria-describedby={goalHintId}
                >
                  <div className="composer-hub-section-head">
                    <h3 id={goalId}>{t('chat.goal')}</h3>
                    <p id={goalHintId}>{t('chat.goalDialogDescription')}</p>
                  </div>
                  <GoalSection
                    goal={goal}
                    running={running}
                    busy={busy}
                    focusObjective={focusObjective}
                    onCommand={onGoalCommand}
                    onStop={() => onGoalStop?.()}
                    onDone={close}
                  />
                </section>
              )}

              {onCompact && (
                <section
                  className="composer-hub-section"
                  aria-labelledby={contextId}
                  aria-describedby={contextHintId}
                >
                  <div className="composer-hub-section-head">
                    <h3 id={contextId}>{t('chat.hubContext')}</h3>
                    <p id={contextHintId}>{t('chat.hubContextDescription')}</p>
                  </div>
                  <p className="composer-hub-usage" id={usageId}>
                    {usageText}
                  </p>
                  {compactResult && (
                    <p className="composer-hub-result" id={resultId}>
                      {compactSummaryText(compactResult, t)}
                    </p>
                  )}
                  <div className="composer-hub-actions">
                    {isCompacting ? (
                      <button
                        type="button"
                        className="hub-button"
                        onClick={() => {
                          onAbortCompaction?.();
                          close();
                        }}
                      >
                        {t('chat.stopCompaction')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="hub-button"
                        disabled={running}
                        title={running ? t('chat.hubCompactBusy') : t('chat.compactContext')}
                        aria-describedby={compactResult ? `${usageId} ${resultId}` : usageId}
                        onClick={() => {
                          onCompact();
                          close();
                        }}
                      >
                        {t('chat.compactContext')}
                      </button>
                    )}
                    {running && <span className="goal-hint">{t('chat.hubCompactBusy')}</span>}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
