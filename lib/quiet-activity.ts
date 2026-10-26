import type { AssistantContentBlock } from "./types";

export interface ActivityCounts {
  reads: number;
  thoughts: number;
}

/** Only explicit read tools belong in the quiet activity fold. */
export function quietActivityCounts(blocks: AssistantContentBlock[]): ActivityCounts | undefined {
  const counts = { reads: 0, thoughts: 0 };
  for (const block of blocks) {
    if (block.type === "thinking") counts.thoughts += 1;
    else if (block.type === "toolCall" && /^(?:read(?:_file)?|.*[._]read(?:_file)?)$/i.test(block.toolName)) counts.reads += 1;
    else return undefined;
  }
  return counts.reads + counts.thoughts > 0 ? counts : undefined;
}
