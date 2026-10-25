/**
 * Fork: which tool cards a run leaves open, and how much of a shell result is
 * shown while it does.
 *
 * The CLI shows every write and every command as it works, step by step; this
 * module gives the chat view the same default. Writes and shell calls start
 * expanded (a write's whole file text, a shell's command and the tail of its
 * output), while read/search stay folded and thinking keeps its own preference
 * (`lib/thinking-expansion-preference.ts`). A card the user folds stays folded:
 * `lib/tool-call-expansion.ts` remembers the explicit choice per tool call.
 *
 * Presentation only, and kept in one file so the fork's rule is a single edit.
 */

import { isWriteToolName } from "./tool-names";

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

/** Tool cards the fork opens by default. */
export function isToolCallExpandedByDefault(toolName: string): boolean {
  return isWriteToolName(toolName) || isShellToolName(toolName);
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
