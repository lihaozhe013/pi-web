'use client';

import { useI18n } from '@/hooks/useI18n';
import type { AgentPhase } from '@/hooks/useAgentSession';
import { selectStreamingMessage, useStreamingSelector } from '@/hooks/useStreamingSelector';
import { composerActivityLabel } from '@/lib/composer-activity';
import type { StreamingStore } from '@/lib/streaming-message';
import type { AgentMessage } from '@/lib/types';

/**
 * The live run status, locked in one row directly above the composer.
 *
 * It lives outside the transcript so a long run stays visible while the user
 * reads history, and its single fixed-height row keeps the composer from moving
 * as tools start and finish. The row stays mounted for the whole run: a stretch
 * with nothing to say (mostly the visible answer streaming) keeps its height and
 * only drops the text, instead of collapsing under the composer.
 */
export function ComposerActivity({
  store,
  phase,
  messages,
  compacting
}: {
  store: StreamingStore;
  phase: AgentPhase;
  messages: AgentMessage[];
  compacting: boolean;
}) {
  const { t } = useI18n();
  const streaming = useStreamingSelector(store, selectStreamingMessage);
  const label = composerActivityLabel(phase, messages, streaming, compacting, t);
  return (
    <div className="composer-activity" role="status" aria-live="polite" title={label ?? undefined}>
      {label && (
        <>
          <span className="composer-activity-dot" aria-hidden="true" />
          <span className="composer-activity-label">{label}</span>
        </>
      )}
    </div>
  );
}
