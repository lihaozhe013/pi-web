"use client";

import { useI18n } from "@/hooks/useI18n";
import type { AgentPhase } from "@/hooks/useAgentSession";
import { selectStreamingMessage, useStreamingSelector } from "@/hooks/useStreamingSelector";
import { phaseLabel } from "@/lib/chat-phase-label";
import { isReadToolName } from "@/lib/quiet-activity";
import type { StreamingStore } from "@/lib/streaming-message";
import type { AgentMessage, ToolCallContent } from "@/lib/types";

/** Live status only: completed reading and reasoning belong in full history. */
export function LiveAgentActivity({ store, phase, messages, compacting, hasStreamingContent }: {
  store: StreamingStore;
  phase: AgentPhase;
  messages: AgentMessage[];
  compacting: boolean;
  hasStreamingContent: boolean;
}) {
  const { t } = useI18n();
  const streaming = useStreamingSelector(store, selectStreamingMessage);
  let labels: string[] = [];
  if (compacting) labels = [t("chat.compacting")];
  else if (phase?.kind === "running_tools") {
    const reads = phase.tools.filter(tool => isReadToolName(tool.name));
    if (reads.length > 0) {
      const calls = new Map<string, ToolCallContent>();
      for (const message of [...messages, ...(streaming ? [streaming] : [])]) {
        if (message.role !== "assistant") continue;
        for (const block of message.content) {
          if (block.type === "toolCall") calls.set(block.toolCallId, block);
        }
      }
      labels = reads.map(tool => {
        const input = calls.get(tool.id)?.input;
        const path = input?.path ?? input?.file_path ?? input?.filePath;
        return typeof path === "string" && path.trim()
          ? t("activity.readingFile", { path }) : t("activity.reading");
      });
    }
  } else if (streaming?.content.at(-1)?.type === "thinking") {
    labels = [t("activity.thinking")];
  }
  if (labels.length === 0 && !hasStreamingContent) {
    const fallback = phaseLabel(phase, t, compacting);
    if (fallback) labels = [fallback];
  }
  if (labels.length === 0) return null;
  return <div className="live-agent-activity" role="status" aria-live="polite">
    {labels.map((label, index) => <div key={index} className="live-agent-activity-line" title={label}>
      <span className="live-agent-activity-dot" aria-hidden="true" />
      <span>{label}</span>
    </div>)}
  </div>;
}
