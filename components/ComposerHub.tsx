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

/** The dialog's two levels: the choices, and the goal's own page. */
type HubView = 'options' | 'goal';

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
 *
 * The dialog opens on two choices in the shape the sidebar's "New" dialog uses,
 * **Compact** and **Goal**. Compaction is one action, so it happens from its
 * card; a goal is written, so its card opens a second step holding the goal.
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
  const [view, setView] = useState<HubView>('options');
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const compactRef = useRef<HTMLButtonElement>(null);
  const goalRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const goalHintId = useId();
  const choicesId = useId();
  const compactId = useId();
  const compactStateId = useId();
  const goalChoiceId = useId();

  // A goal is the one subject that needs a second step; with nothing to compact
  // it is also the only subject, so the entry opens straight onto it.
  const goalOnly = Boolean(onGoalCommand) && !onCompact;
  const active = isGoalRunning(goal);
  const statusLabel = goal ? t(goalStatusLabelKey(goal.status)) : null;
  // A goal is the reason to open this: land on its objective, or on the dialog
  // when the goal cannot be edited while a run holds it.
  const focusObjective = canEditObjective(goal) && !busy;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || view !== 'goal') return;
    // The section focuses its own field, so the dialog only takes focus when the
    // goal is read-only; otherwise focus would move twice.
    if (!focusObjective) dialogRef.current?.focus();
  }, [open, view, focusObjective]);

  useEffect(() => {
    if (!open || view !== 'options') return;
    // The choices are the page: focus the first one that can be used, so Tab
    // order follows what is read first and a held session never eats the focus.
    const first =
      compactRef.current && !compactRef.current.disabled ? compactRef.current : goalRef.current;
    (first ?? dialogRef.current)?.focus();
  }, [open, view]);

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
      onClick={() => {
        setView(goalOnly ? 'goal' : 'options');
        setOpen(true);
      }}
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

  const compactTitle = isCompacting ? t('chat.stopCompaction') : t('chat.compactContext');
  // A running session holds the context, so compaction waits for idle — except
  // that the run holding it can be the compaction itself.
  const compactBusy = running && !isCompacting;

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
              // One level at a time: Escape leaves the goal first, the dialog second.
              if (view === 'goal' && !goalOnly) {
                setView('options');
                return;
              }
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
            data-view={view}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={view === 'goal' ? goalHintId : choicesId}
            tabIndex={-1}
          >
            {view === 'goal' ? (
              <>
                <header className="composer-hub-header">
                  <div className="composer-hub-heading">
                    {!goalOnly && (
                      <button
                        type="button"
                        className="composer-hub-back"
                        onClick={() => setView('options')}
                        aria-label={t('chat.hubBack')}
                        title={t('chat.hubBack')}
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M15 5l-7 7 7 7" />
                        </svg>
                      </button>
                    )}
                    <div>
                      <h2 id={titleId}>{t('chat.goal')}</h2>
                      <p id={goalHintId}>{t('chat.goalDialogDescription')}</p>
                    </div>
                  </div>
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
                    <div className="composer-hub-section">
                      <GoalSection
                        goal={goal}
                        running={running}
                        busy={busy}
                        focusObjective={focusObjective}
                        onCommand={onGoalCommand}
                        onStop={() => onGoalStop?.()}
                        onDone={close}
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <header className="composer-hub-header">
                  <div className="composer-hub-heading">
                    <div>
                      <h2 id={titleId}>{t('chat.hubTitle')}</h2>
                      <p id={choicesId}>{t('chat.hubChooserDescription')}</p>
                    </div>
                  </div>
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
                  <div className="composer-hub-options">
                    {onCompact && (
                      <button
                        ref={compactRef}
                        type="button"
                        className="composer-hub-choice"
                        disabled={compactBusy}
                        title={t('chat.hubContextDescription')}
                        aria-label={compactTitle}
                        aria-describedby={`${compactId} ${compactStateId}`}
                        onClick={() => {
                          if (isCompacting) onAbortCompaction?.();
                          else onCompact();
                          close();
                        }}
                      >
                        <span className="composer-hub-choice-icon" aria-hidden="true">
                          <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M4 8h16M4 16h16" />
                            <path d="M9 4l-3 4 3 4M15 12l3 4-3 4" />
                          </svg>
                        </span>
                        <span className="composer-hub-choice-title">{compactTitle}</span>
                        <span id={compactId} className="composer-hub-choice-description">
                          {compactBusy
                            ? t('chat.hubCompactBusy')
                            : t('chat.hubContextDescription')}
                        </span>
                        <span id={compactStateId} className="composer-hub-choice-meta">
                          {usageText}
                          {compactResult && (
                            <span className="composer-hub-choice-note">
                              {compactSummaryText(compactResult, t)}
                            </span>
                          )}
                        </span>
                      </button>
                    )}

                    {onGoalCommand && (
                      <button
                        ref={goalRef}
                        type="button"
                        className="composer-hub-choice"
                        data-state={active ? 'active' : 'idle'}
                        aria-label={goal ? `${t('chat.goal')}: ${statusLabel}` : t('chat.goal')}
                        aria-describedby={goalChoiceId}
                        onClick={() => setView('goal')}
                      >
                        <span className="composer-hub-choice-icon" aria-hidden="true">
                          <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="12" cy="12" r="8" />
                            <circle cx="12" cy="12" r="2.5" />
                          </svg>
                        </span>
                        <span className="composer-hub-choice-title">
                          {t('chat.goal')}
                          {statusLabel && (
                            <span className="composer-hub-choice-state">{statusLabel}</span>
                          )}
                        </span>
                        <span id={goalChoiceId} className="composer-hub-choice-description">
                          {goal ? goal.objective : t('chat.goalDialogDescription')}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
