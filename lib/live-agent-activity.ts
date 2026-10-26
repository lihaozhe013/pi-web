import type { AgentPhase } from "@/hooks/useAgentSession";
import { phaseLabel, type Translate } from "./chat-phase-label";
import { isShellToolName } from "./fork-tool-expansion";
import { isReadToolName } from "./quiet-activity";
import type { AgentMessage, AssistantMessage, ToolCallContent } from "./types";

/** Explicit execution/wait phases win over any stale streamed reasoning. */
export function liveAgentActivityLabels(
  phase: AgentPhase,
  messages: AgentMessage[],
  streaming: AssistantMessage | null,
  compacting: boolean,
  t: Translate,
): string[] {
  if (compacting) return [t("chat.compacting")];
  if (phase?.kind === "running_tools") {
    const calls = new Map<string, ToolCallContent>();
    for (const message of [...messages, ...(streaming ? [streaming] : [])]) {
      if (message.role !== "assistant") continue;
      for (const block of message.content) {
        if (block.type === "toolCall") calls.set(block.toolCallId, block);
      }
    }
    if (phase.tools.length === 0) return [t("chat.runningTool")];
    return phase.tools.map(tool => {
      const input = calls.get(tool.id)?.input;
      let label: string;
      if (isReadToolName(tool.name)) {
        const path = input?.path ?? input?.file_path ?? input?.filePath;
        label = typeof path === "string" && path.trim()
          ? t("activity.readingFile", { path }) : t("activity.reading");
      } else if (isShellToolName(tool.name)) {
        const command = input?.command ?? input?.cmd;
        label = typeof command === "string" && command.trim()
          ? t("activity.runningCommand", { command: command.trim().replace(/\s+/g, " ") })
          : t("chat.runningNamedTool", { name: tool.name });
      } else {
        label = t("chat.runningNamedTool", { name: tool.name });
      }
      return tool.progress ? `${label} ${tool.progress}` : label;
    });
  }
  if (phase?.kind === "waiting_model") return [t("activity.waitingProvider")];
  const fallback = phaseLabel(phase, t);
  if (fallback) return [fallback];
  if (streaming?.content.at(-1)?.type === "thinking") return [t("activity.thinking")];
  return [];
}
