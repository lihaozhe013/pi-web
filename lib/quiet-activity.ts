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
 * Shell and codemode runs never draw a transcript card: they live in the Runs
 * panel, which keeps them after they finish. Every rule here reads persisted
 * results and the reported running calls, never a streamed fragment as if it
 * were a result.
 */
export function isTransientToolBlock(
  block: AssistantContentBlock,
  results?: ReadonlyMap<string, ToolResultMessage>,
  running?: ReadonlySet<string>
): boolean {
  if (block.type !== 'toolCall') return false;
  // Shell and codemode runs live in the Runs panel, whether they run, succeed or
  // fail. The transcript keeps no card for them at all.
  if (isShellToolName(block.toolName) || block.toolName === CODEMODE_TOOL_NAME) return true;
  // The dedicated question panel is the interaction; do not duplicate its raw call
  // in the transcript while it waits. Completed results remain inspectable.
  if (running?.has(block.toolCallId)) return block.toolName === 'ask_user';
  const result = results?.get(block.toolCallId);
  if (result === undefined) return true;
  return false;
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
