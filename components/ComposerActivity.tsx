'use client';

import { useRef } from 'react';
import { useI18n } from '@/hooks/useI18n';
import type { AgentPhase } from '@/hooks/useAgentSession';
import { selectStreamingMessage, useStreamingSelector } from '@/hooks/useStreamingSelector';
import { useExitHold } from '@/hooks/useToolCardMotion';
import { composerActivityLabel, composerActivityTokens } from '@/lib/composer-activity';
import { formatCompactCount } from '@/lib/session-stats-format';
import { createBlockEstimator, type BlockEstimator } from '@/lib/token-estimate';
import type { StreamingStore } from '@/lib/streaming-message';
import type { AgentMessage } from '@/lib/types';

/**
 * The live run status, locked in one row directly above the composer.
 *
 * It lives outside the transcript so a long run stays visible while the user
 * reads history, and its single fixed-height row keeps the composer from moving
 * as tools start and finish. The row is always mounted: it opens when a run
 * starts, folds away when the run ends, and only its text changes in between, so
 * the composer never jumps under the user's cursor.
 */
export function ComposerActivity({
  store,
  phase,
  messages,
  compacting,
  running
}: {
  store: StreamingStore;
  phase: AgentPhase;
  messages: AgentMessage[];
  compacting: boolean;
  /** The agent is working: the row is open and says what it is doing. */
  running: boolean;
}) {
  const { t } = useI18n();
  const streaming = useStreamingSelector(store, selectStreamingMessage);
  // Reading the label walks the transcript's tool inputs, so it is derived only
  // while a run needs it.
  const label = running ? composerActivityLabel(phase, messages, streaming, compacting, t) : null;
  // The estimate continues from the previous render's count instead of rescanning
  // a block that may have grown for minutes, and lives only as long as a run.
  const estimatorRef = useRef<BlockEstimator | null>(null);
  estimatorRef.current ??= createBlockEstimator();
  const estimate = running
    ? composerActivityTokens(phase, messages, streaming, compacting, estimatorRef.current)
    : null;
  const tokens =
    estimate !== null && Math.round(estimate) >= 1
      ? t('activity.tokenEstimate', { tokens: formatCompactCount(Math.round(estimate)) })
      : null;
  // The run's last words, so the row can fade out saying them.
  const lastLabel = useRef('');
  if (label) lastLabel.current = label;
  const { open, exiting } = useExitHold(running);
  // A visible answer drops the text but keeps the row's height, as before; once
  // the run is over only the row on its way out still says the last thing.
  const text = running ? label : open ? lastLabel.current : '';
  return (
    <div
      className="composer-activity-slot"
      data-open={running ? 'true' : undefined}
      data-fading={exiting ? 'true' : undefined}
    >
      <div className="composer-activity-row">
        <div
          className="composer-activity"
          data-visible={text ? 'true' : undefined}
          role="status"
          aria-live="polite"
          aria-hidden={text ? undefined : true}
          title={text || undefined}
        >
          <span className="composer-activity-dot" aria-hidden="true" />
          <span className="composer-activity-label" key={text}>
            {text}
          </span>
          {tokens && (
            <span className="composer-activity-tokens" title={t('i18n.estimatedTokens')}>
              {tokens}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
