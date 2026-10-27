import { CODEMODE_TOOL_NAME } from './codemode-view';
import { isExplorationToolName, isShellToolName } from './tool-names';
import type { AssistantContentBlock, ToolResultMessage } from './types';

/**
 * Exploration calls leave no card: the composer status row carries them while
 * they run, and their result is context the model reads, not a step the user
 * asked to inspect.
 */
export function isQuietActivityBlock(block: AssistantContentBlock): boolean {
  return (
    block.type === 'thinking' ||
    (block.type === 'toolCall' && isExplorationToolName(block.toolName))
  );
}

/**
 * A tool call earns a card once it actually runs, not while the model is still
 * writing its arguments: a half-streamed JSON blob would intrude on the
 * conversation, while a running call's card is the progress the user asked for.
 *
 * A successful shell command or codemode script leaves no card at all; a
 * failed one keeps its error summary. Every rule here reads persisted results
 * and the reported running calls, never a streamed fragment as if it were a result.
 */
export function isTransientToolBlock(
  block: AssistantContentBlock,
  results?: ReadonlyMap<string, ToolResultMessage>,
  running?: ReadonlySet<string>
): boolean {
  if (block.type !== 'toolCall') return false;
  // The dedicated question panel is the interaction; do not duplicate its raw call
  // in the transcript while it waits. Completed results remain inspectable.
  if (running?.has(block.toolCallId)) return block.toolName === 'ask_user';
  const result = results?.get(block.toolCallId);
  if (result === undefined) return true;
  // A codemode script is transient exactly like a shell command: its card is the
  // progress while it runs, and a success leaves the transcript.
  return (
    (isShellToolName(block.toolName) || block.toolName === CODEMODE_TOOL_NAME) && !result.isError
  );
}

/** Display filtering never changes the stored transcript or exported history. */
export function mainTranscriptBlocks(
  blocks: AssistantContentBlock[],
  results?: ReadonlyMap<string, ToolResultMessage>,
  running?: ReadonlySet<string>
): AssistantContentBlock[] {
  return blocks.filter(
    (block) => !isQuietActivityBlock(block) && !isTransientToolBlock(block, results, running)
  );
}
