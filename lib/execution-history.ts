/**
 * The shell and codemode runs of a conversation, for the Runs panel.
 *
 * The transcript no longer carries these calls: a command's live output and its
 * final result belong to one history that stays readable after the run ends,
 * whether it succeeded or failed. The entries here are display views derived
 * from stored messages plus the live execution state, never a second record.
 */

import {
  CODEMODE_TOOL_NAME,
  codemodeCalls,
  codemodeScript,
  codemodeScriptPreview,
  stripCodemodeHeader,
  type CodemodeCallView
} from './codemode-view';
import { isShellToolName } from './tool-names';
import type {
  AgentMessage,
  AssistantMessage,
  BashExecutionMessage,
  ToolCallContent,
  ToolResultMessage
} from './types';

export type ExecutionHistoryStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface ExecutionHistoryEntry {
  id: string;
  kind: 'shell' | 'codemode';
  toolName: string;
  /** The full command or script. */
  command: string;
  /** One line for the collapsed row. */
  preview: string;
  status: ExecutionHistoryStatus;
  /** Text output; empty while a run has not printed anything yet. */
  output: string;
  /** The script of a codemode call, when it has one. */
  script?: string;
  /** Calls the codemode script made, in the order they ran. */
  calls?: CodemodeCallView[];
  /** Earlier codemode calls a progress snapshot left out. */
  omittedCalls?: number;
  /** A `!` command the user ran in the composer. */
  userInitiated?: boolean;
  timestamp?: number;
  durationMs?: number;
  /** A shell result whose full output was written elsewhere. */
  truncated?: boolean;
  fullOutputPath?: string;
}

/** Trailing lines shown before the whole output waits behind a button. */
export const EXECUTION_OUTPUT_TAIL_LINES = 40;

/** The client-only run of a `!` command before its stored message arrives. */
export const PENDING_BASH_ID = 'bash-pending';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inputText(input: unknown): string {
  if (!isRecord(input)) return typeof input === 'string' ? input : '';
  for (const key of ['command', 'cmd', 'script', 'input'] as const) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return '';
  }
}

function limitPreview(line: string): string {
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

function firstCommandLine(command: string): string {
  for (const line of command.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return limitPreview(trimmed);
  }
  return '';
}

function resultText(content: ToolResultMessage['content'] | undefined): string {
  if (!content) return '';
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        block.type === 'text' && typeof block.text === 'string'
    )
    .map((block) => block.text)
    .join('\n');
}

function recordedDuration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function entryDuration(
  message: AssistantMessage,
  result: ToolResultMessage | undefined
): number | undefined {
  if (!result) return undefined;
  return (
    recordedDuration(result.durationMs) ??
    (result.timestamp !== undefined && message.timestamp !== undefined
      ? Math.max(0, result.timestamp - message.timestamp)
      : undefined)
  );
}

function shellStatus(result: ToolResultMessage | undefined): ExecutionHistoryStatus {
  if (!result) return 'running';
  if (isRecord(result.details) && result.details.cancelled === true) return 'cancelled';
  return result.isError ? 'error' : 'success';
}

function bashExecutionStatus(message: BashExecutionMessage): ExecutionHistoryStatus {
  if (message.cancelled) return 'cancelled';
  if (message.exitCode !== undefined) return message.exitCode === 0 ? 'success' : 'error';
  return 'running';
}

function shellEntry(
  message: AssistantMessage,
  block: ToolCallContent,
  result: ToolResultMessage | undefined,
  live: boolean
): ExecutionHistoryEntry {
  const command = inputText(block.input);
  return {
    id: block.toolCallId,
    kind: 'shell',
    toolName: block.toolName,
    command,
    preview: firstCommandLine(command),
    status: live ? 'running' : shellStatus(result),
    output: resultText(result?.content),
    timestamp: message.timestamp,
    durationMs: entryDuration(message, result)
  };
}

function codemodeEntry(
  message: AssistantMessage,
  block: ToolCallContent,
  result: ToolResultMessage | undefined,
  live: boolean
): ExecutionHistoryEntry {
  const script = codemodeScript(block.input);
  const command = script ?? inputText(block.input);
  const calls = codemodeCalls(result?.details);
  return {
    id: block.toolCallId,
    kind: 'codemode',
    toolName: block.toolName,
    command,
    preview:
      script !== null ? limitPreview(codemodeScriptPreview(script)) : firstCommandLine(command),
    status: live ? 'running' : shellStatus(result),
    output: resultText(result ? stripCodemodeHeader(result.content) : undefined),
    ...(script !== null ? { script } : {}),
    calls: calls.calls,
    omittedCalls: calls.omitted,
    timestamp: message.timestamp,
    durationMs: entryDuration(message, result)
  };
}

function userBashEntry(message: BashExecutionMessage, index: number): ExecutionHistoryEntry {
  const status = bashExecutionStatus(message);
  const toolName = message.excludeFromContext ? 'bash (local)' : 'bash';
  return {
    id: `bash-${message.timestamp ?? index}`,
    kind: 'shell',
    toolName,
    command: message.command,
    preview: firstCommandLine(message.command),
    status,
    output: message.output,
    userInitiated: true,
    timestamp: message.timestamp,
    ...(message.truncated ? { truncated: true } : {}),
    ...(message.fullOutputPath ? { fullOutputPath: message.fullOutputPath } : {})
  };
}

/**
 * Every shell and codemode run in the loaded conversation, oldest first.
 *
 * `running` is the same live set the transcript cards use, and `results` also
 * carries a running call's partial result, so a command's output grows in the
 * panel while it runs. A call the session never executed leaves no entry.
 */
export function buildExecutionHistory(
  messages: readonly AgentMessage[],
  results: ReadonlyMap<string, ToolResultMessage>,
  running: ReadonlySet<string>,
  options: {
    pendingBash?: { command: string; excludeFromContext?: boolean } | null;
  } = {}
): ExecutionHistoryEntry[] {
  const entries: ExecutionHistoryEntry[] = [];

  for (const [index, message] of messages.entries()) {
    if (message.role === 'bashExecution') {
      entries.push(userBashEntry(message, index));
      continue;
    }
    if (message.role !== 'assistant') continue;

    for (const block of message.content) {
      if (block.type !== 'toolCall') continue;
      const codemode = block.toolName === CODEMODE_TOOL_NAME;
      if (!codemode && !isShellToolName(block.toolName)) continue;

      const result = results.get(block.toolCallId);
      const live = running.has(block.toolCallId);
      if (!result && !live) continue;

      entries.push(
        codemode
          ? codemodeEntry(message, block, result, live)
          : shellEntry(message, block, result, live)
      );
    }
  }

  if (options.pendingBash) {
    const command = options.pendingBash.command;
    entries.push({
      id: PENDING_BASH_ID,
      kind: 'shell',
      toolName: options.pendingBash.excludeFromContext ? 'bash (local)' : 'bash',
      command,
      preview: firstCommandLine(command),
      status: 'running',
      output: '',
      userInitiated: true
    });
  }

  return entries;
}

/**
 * Keep a run that just disappeared from the derived list in its old place.
 *
 * pi emits `tool_execution_end` before the stored `toolResult` message, so one
 * render can see a finished call with neither a result nor a live marker. The
 * retained run is replaced by the same id when the result arrives, and the
 * panel removes it if no result ever does.
 */
export function retainExecutionHistory(
  previous: readonly ExecutionHistoryEntry[],
  current: readonly ExecutionHistoryEntry[]
): ExecutionHistoryEntry[] {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const merged: ExecutionHistoryEntry[] = [];
  for (const entry of previous) {
    const replacement = byId.get(entry.id);
    if (replacement) {
      merged.push(replacement);
      seen.add(entry.id);
    } else {
      merged.push(entry);
    }
  }
  for (const entry of current) {
    if (seen.has(entry.id)) continue;
    merged.push(entry);
  }
  return merged;
}

/** The last lines of a run's output, with the number left above them. */
export function executionOutputTail(
  text: string,
  maxLines = EXECUTION_OUTPUT_TAIL_LINES
): { tail: string; hiddenLines: number } | null {
  if (!text) return null;
  const lines = text.split('\n');
  const lineCount =
    lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  if (lineCount <= maxLines) return null;
  const hiddenLines = lineCount - maxLines;
  return { tail: lines.slice(hiddenLines).join('\n'), hiddenLines };
}

/** A run's duration in the same short form the tool cards used. */
export function formatExecutionDuration(ms: number | undefined): string | null {
  if (ms === undefined || ms < 100) return null;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}
