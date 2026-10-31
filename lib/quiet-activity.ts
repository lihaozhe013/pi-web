import { isExplorationToolName, isRunsPanelToolName } from './tool-names';
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
 * Every call except a write or an edit lives in the Runs panel, running,
 * successful or failed, and never draws a transcript card. Every rule here
 * reads persisted results and the reported running calls, never a streamed
 * fragment as if it were a result.
 */
export function isTransientToolBlock(
  block: AssistantContentBlock,
  results?: ReadonlyMap<string, ToolResultMessage>,
  running?: ReadonlySet<string>
): boolean {
  if (block.type !== 'toolCall') return false;
  if (isRunsPanelToolName(block.toolName)) return true;
  if (running?.has(block.toolCallId)) return false;
  const result = results?.get(block.toolCallId);
  return result === undefined;
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
