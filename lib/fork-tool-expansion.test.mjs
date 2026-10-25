import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  getToolCallExpansion,
  clearExpandedToolCalls,
  setToolCallExpanded,
} = await jiti.import("@/lib/tool-call-expansion");
const {
  SHELL_TAIL_LINES,
  isShellToolName,
  isToolCallExpandedByDefault,
  shellResultTail,
} = await jiti.import("@/lib/fork-tool-expansion");

test("writes, edits and patches open only after success", () => {
  for (const name of ["write", "write_file", "box.write", "mcp__fs__write", "edit", "edit_file", "box.edit", "apply_patch"]) {
    for (const state of ["pending", "running", "error"]) {
      assert.equal(isToolCallExpandedByDefault(name, state), false, `${name}: ${state}`);
    }
    assert.equal(isToolCallExpandedByDefault(name, "success"), true, name);
  }
});

test("shells open at execution, reads and searches never auto-open", () => {
  for (const name of ["bash", "bash (local)", "powershell", "shell", "exec_command", "box.run_command", "mcp__box__shell"]) {
    assert.equal(isToolCallExpandedByDefault(name, "pending"), false, name);
    for (const state of ["running", "success", "error"]) {
      assert.equal(isToolCallExpandedByDefault(name, state), true, name);
    }
  }
  for (const name of ["read", "grep", "find", "ls", "webfetch"]) {
    for (const state of ["pending", "running", "success", "error"]) {
      assert.equal(isToolCallExpandedByDefault(name, state), false, name);
    }
  }
});

test("tells a shell tool from a name that only contains the word", () => {
  assert.equal(isShellToolName("bash"), true);
  assert.equal(isShellToolName("BASH"), true);
  assert.equal(isShellToolName("bash-output"), true);
  assert.equal(isShellToolName("shellcheck"), false);
  assert.equal(isShellToolName("read"), false);
});

test("a shell result keeps its last lines and counts the ones left out", () => {
  const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
  const tail = shellResultTail(lines.join("\n"));
  assert.ok(tail);
  assert.equal(tail.hiddenLines, 40 - SHELL_TAIL_LINES);
  assert.equal(tail.tail.split("\n").length, SHELL_TAIL_LINES);
  assert.equal(tail.tail.split("\n")[0], `line ${40 - SHELL_TAIL_LINES + 1}`);
  assert.equal(tail.tail.split("\n").at(-1), "line 40");
  // A trailing newline ends the last line, it does not start another.
  assert.equal(shellResultTail(`${lines.join("\n")}\n`)?.hiddenLines, 40 - SHELL_TAIL_LINES);
});

test("a shell result that already fits is shown whole", () => {
  assert.equal(shellResultTail(""), null);
  assert.equal(shellResultTail("one line"), null);
  assert.equal(shellResultTail(Array.from({ length: SHELL_TAIL_LINES }, (_, i) => `l${i}`).join("\n")), null);
});

test("an untouched card has no explicit expansion, a toggled one does", () => {
  clearExpandedToolCalls();
  assert.equal(getToolCallExpansion("call_auto"), undefined);
  setToolCallExpanded("call_auto", false);
  assert.equal(getToolCallExpansion("call_auto"), false);
  setToolCallExpanded("call_auto", true);
  assert.equal(getToolCallExpansion("call_auto"), true);
});
