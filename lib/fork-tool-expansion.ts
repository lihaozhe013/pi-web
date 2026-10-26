/**
 * Shell and file mutation details open during execution and fold on completion.
 * Explicit choices continue to take precedence over these lifecycle defaults.
 */

import { isWriteToolName, isEditToolName, isApplyPatchToolName } from "./tool-names";

/** Tool names that run a command, bare or as a decorated/mcp form. */
const SHELL_TOOL_NAMES = new Set([
  "bash",
  "shell",
  "sh",
  "zsh",
  "powershell",
  "pwsh",
  "cmd",
  "exec",
  "exec_command",
  "run_command",
  "run_shell_command",
  "execute_command",
  "terminal",
  "local_shell",
]);

/** How many trailing lines of a shell result stay visible while the rest waits. */
export const SHELL_TAIL_LINES = 16;

export function isShellToolName(toolName: string): boolean {
  const name = toolName.toLowerCase().trim();
  // `bash (local)` (a transcript's user-run shell) is the bare name plus a note.
  const head = name.split(/[\s(]/)[0];
  if (SHELL_TOOL_NAMES.has(head)) return true;
  // The decorated forms extensions register: `mcp__box__shell`, `box.run_command`.
  const tail = head.split(/\.|__/).pop() ?? head;
  if (SHELL_TOOL_NAMES.has(tail)) return true;
  // `bash_local`, `sandbox-bash`: the name carries the shell word as a whole part.
  return /(^|[._-])(bash|shell|powershell)([._-]|$)/.test(head);
}

export type ForkToolState = "pending" | "running" | "success" | "error";

/** Defaults are derived every render, never stored as a user's explicit choice. */
export function isToolCallExpandedByDefault(toolName: string, state: ForkToolState = "pending"): boolean {
  return state === "running" && (isShellToolName(toolName) || isWriteToolName(toolName) || isEditToolName(toolName) || isApplyPatchToolName(toolName));
}

/**
 * The last `SHELL_TAIL_LINES` lines of a shell result, with the count of the
 * ones left out. Null when the whole result already fits (or is empty), so the
 * card can draw its normal output pane.
 */
export function shellResultTail(text: string): { tail: string; hiddenLines: number } | null {
  if (!text) return null;
  const lines = text.split("\n");
  // A trailing newline ends the last line, it does not start another.
  const lineCount = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  if (lineCount <= SHELL_TAIL_LINES) return null;
  const hiddenLines = lineCount - SHELL_TAIL_LINES;
  return { tail: lines.slice(hiddenLines).join("\n"), hiddenLines };
}
