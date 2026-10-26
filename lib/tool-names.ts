/**
 * Tool-name predicates shared by the chat views.
 *
 * Pi's built-in names are plain `write` / `edit`, but MCP servers expose the
 * same operations under prefixed or namespaced names, so each predicate also
 * accepts the common decorated forms.
 */

export function isWriteToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "write" ||
    name.startsWith("write_") ||
    name.endsWith(".write") ||
    name.endsWith("_write");
}

export function isEditToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "edit" ||
    name.startsWith("edit_") ||
    name.endsWith(".edit") ||
    name.endsWith("_edit") ||
    name.includes("str_replace") ||
    name.includes("replace_editor");
}

/** Codex-style patch tools (e.g. the pi-apply-patch extension). */
export function isApplyPatchToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "apply_patch" ||
    name.startsWith("apply_patch_") ||
    name.endsWith(".apply_patch") ||
    name.endsWith("_apply_patch");
}

/** Recognizes shell tools, including names decorated by extensions. */
const SHELL_TOOL_NAMES = new Set([
  "bash", "shell", "sh", "zsh", "powershell", "pwsh", "cmd", "exec",
  "exec_command", "run_command", "run_shell_command", "execute_command",
  "terminal", "local_shell",
]);

export function isShellToolName(toolName: string): boolean {
  const name = toolName.toLowerCase().trim();
  const head = name.split(/[\s(]/)[0];
  if (SHELL_TOOL_NAMES.has(head)) return true;
  const tail = head.split(/\.|__/).pop() ?? head;
  if (SHELL_TOOL_NAMES.has(tail)) return true;
  return /(^|[._-])(bash|shell|powershell)([._-]|$)/.test(head);
}
