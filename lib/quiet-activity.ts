import { isShellToolName } from "./tool-names";
import type { AssistantContentBlock, ToolResultMessage } from "./types";

/** Only explicit read tools are transient in the main conversation. */
export function isReadToolName(name: string): boolean {
  return /^(?:read(?:_file)?|.*[._]read(?:_file)?)$/i.test(name);
}

export function isQuietActivityBlock(block: AssistantContentBlock): boolean {
  return block.type === "thinking" || (block.type === "toolCall" && isReadToolName(block.toolName));
}

export function isCompletedShellBlock(block: AssistantContentBlock, results?: ReadonlyMap<string, ToolResultMessage>): boolean {
  if (block.type !== "toolCall" || !isShellToolName(block.toolName)) return false;
  const result = results?.get(block.toolCallId);
  return result !== undefined && !result.isError;
}

/** Display filtering never changes the stored transcript or exported history. */
export function mainTranscriptBlocks(blocks: AssistantContentBlock[], results?: ReadonlyMap<string, ToolResultMessage>): AssistantContentBlock[] {
  return blocks.filter(block => !isQuietActivityBlock(block) && !isCompletedShellBlock(block, results));
}
