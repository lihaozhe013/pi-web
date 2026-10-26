import type { AgentPhase } from '@/hooks/useAgentSession';
import {
  isExplorationToolName,
  isListToolName,
  isSearchToolName,
  isShellToolName
} from './tool-names';
import type { AgentMessage, AssistantMessage } from './types';

/** The i18n translate function shape this module needs. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

type ToolInput = Record<string, unknown> | undefined;

interface RunningTool {
  id: string;
  name: string;
  progress?: string;
}

/**
 * One line above the composer describes what the agent is doing right now.
 *
 * Explicit execution/wait phases win over stale streamed reasoning: after a tool
 * call the reasoning block is still the last streamed content, while the turn has
 * already moved on. Compaction takes precedence over everything, because
 * auto-compaction can hold a turn for a long time and the underlying phase would
 * read as a hang.
 */
export function composerActivityLabel(
  phase: AgentPhase,
  messages: AgentMessage[],
  streaming: AssistantMessage | null,
  compacting: boolean,
  t: Translate
): string | null {
  if (compacting) return t('chat.compacting');
  if (phase?.kind === 'running_tools') {
    if (phase.tools.length === 0) return t('chat.runningTool');
    return summarizeRunningTools(phase.tools, collectToolInputs(messages, streaming), t);
  }
  // The model writes a call's arguments before pi reports it as running, and while
  // it does the phase can still name the previous wait. Naming the tool keeps the
  // row alive through that stretch instead of blanking it until execution starts.
  const drafting = lastStreamedToolCall(streaming);
  if (drafting !== null) return t('activity.preparingTool', { name: drafting });
  if (phase?.kind === 'waiting_model') return t('activity.waitingProvider');
  if (phase?.kind === 'running_command') return t('chat.runningCommand');
  if (streaming?.content.at(-1)?.type === 'thinking') return t('activity.thinking');
  return null;
}

/** The tool whose arguments the streaming reply is still writing, if any. */
function lastStreamedToolCall(streaming: AssistantMessage | null): string | null {
  const block = streaming?.content.at(-1);
  return block?.type === 'toolCall' ? block.toolName : null;
}

/** Streamed arguments arrive before the call is reported as running. */
function collectToolInputs(
  messages: AgentMessage[],
  streaming: AssistantMessage | null
): Map<string, ToolInput> {
  const calls = new Map<string, ToolInput>();
  for (const message of [...messages, ...(streaming ? [streaming] : [])]) {
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (block.type === 'toolCall') calls.set(block.toolCallId, block.input);
    }
  }
  return calls;
}

/**
 * The status line stays a single fixed-height row, so concurrent calls are grouped
 * by kind instead of growing the line count. A group of one keeps its concrete
 * detail (path, pattern, command, tool name); a group of several becomes a count.
 */
function summarizeRunningTools(
  tools: RunningTool[],
  inputs: Map<string, ToolInput>,
  t: Translate
): string {
  const reads: string[] = [];
  const searches: string[] = [];
  const listings: string[] = [];
  const shells: string[] = [];
  const others: string[] = [];
  for (const tool of tools) {
    if (isSearchToolName(tool.name)) searches.push(searchLabel(tool, inputs.get(tool.id), t));
    else if (isListToolName(tool.name)) listings.push(listingLabel(tool, inputs.get(tool.id), t));
    else if (isExplorationToolName(tool.name)) reads.push(readLabel(tool, inputs.get(tool.id), t));
    else if (isShellToolName(tool.name)) shells.push(shellLabel(tool, inputs.get(tool.id), t));
    else others.push(tool.name);
  }

  if (tools.length === 1) {
    const [label] = [...reads, ...searches, ...listings, ...shells];
    if (label !== undefined) return withProgress(label, tools[0]);
    return withProgress(t('chat.runningNamedTool', { name: tools[0].name }), tools[0]);
  }

  const parts: string[] = [];
  if (reads.length === 1) parts.push(reads[0]);
  else if (reads.length > 1) parts.push(t('activity.readingFiles', { count: reads.length }));
  if (searches.length === 1) parts.push(searches[0]);
  else if (searches.length > 1)
    parts.push(t('activity.searchingCount', { count: searches.length }));
  if (listings.length === 1) parts.push(listings[0]);
  else if (listings.length > 1) parts.push(t('activity.listingCount', { count: listings.length }));
  if (shells.length === 1) parts.push(shells[0]);
  else if (shells.length > 1) parts.push(t('activity.runningCommands', { count: shells.length }));
  if (others.length > 0) parts.push(otherToolsLabel(others, t));
  return parts.join(' · ');
}

function readLabel(tool: RunningTool, input: ToolInput, t: Translate): string {
  const path = input?.path ?? input?.file_path ?? input?.filePath;
  return typeof path === 'string' && path.trim()
    ? t('activity.readingFile', { path })
    : t('activity.reading');
}

function searchLabel(tool: RunningTool, input: ToolInput, t: Translate): string {
  const pattern = input?.pattern ?? input?.query;
  if (typeof pattern !== 'string' || !pattern.trim()) return t('activity.searching');
  const path = input?.path ?? input?.file_path ?? input?.filePath;
  return typeof path === 'string' && path.trim()
    ? t('activity.searchingPatternIn', { pattern: pattern.trim(), path })
    : t('activity.searchingPattern', { pattern: pattern.trim() });
}

function listingLabel(tool: RunningTool, input: ToolInput, t: Translate): string {
  const path = input?.path ?? input?.file_path ?? input?.filePath;
  return typeof path === 'string' && path.trim()
    ? t('activity.listingPath', { path })
    : t('activity.listing');
}

function shellLabel(tool: RunningTool, input: ToolInput, t: Translate): string {
  const command = input?.command ?? input?.cmd;
  if (typeof command !== 'string' || !command.trim())
    return t('chat.runningNamedTool', { name: tool.name });
  return t('activity.runningCommand', { command: command.trim().replace(/\s+/g, ' ') });
}

function otherToolsLabel(names: string[], t: Translate): string {
  if (names.length === 1) return t('chat.runningNamedTool', { name: names[0] });
  if (names.length <= 3) return t('chat.runningTools', { names: names.join(', ') });
  return t('chat.runningToolsMore', {
    names: names.slice(0, 2).join(', '),
    count: names.length - 2
  });
}

function withProgress(label: string, tool: RunningTool): string {
  return tool.progress ? `${label} ${tool.progress}` : label;
}
