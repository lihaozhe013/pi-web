'use client';

import { useI18n } from '@/hooks/useI18n';
import type { AgentPhase } from '@/hooks/useAgentSession';
import { selectStreamingMessage, useStreamingSelector } from '@/hooks/useStreamingSelector';
import { liveAgentActivityLabels } from '@/lib/live-agent-activity';
import type { StreamingStore } from '@/lib/streaming-message';
import type { AgentMessage } from '@/lib/types';

/** Live status only: completed reading and reasoning belong in full history. */
export function LiveAgentActivity({
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
  const labels = liveAgentActivityLabels(phase, messages, streaming, compacting, t);
  if (labels.length === 0) return null;
  return (
    <div className="live-agent-activity" role="status" aria-live="polite">
      {labels.map((label, index) => (
        <div key={index} className="live-agent-activity-line" title={label}>
          <span className="live-agent-activity-dot" aria-hidden="true" />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
