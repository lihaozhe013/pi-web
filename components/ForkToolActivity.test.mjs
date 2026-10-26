import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { MessageView } = await jiti.import("./MessageView.tsx");
const { ForkToolActivityProvider } = await jiti.import("./ForkToolActivity.tsx");
const { clearExpandedToolCalls, setToolCallExpanded } = await jiti.import("@/lib/tool-call-expansion");

function render(toolName, { running = false, partial = false, complete = false, error = false } = {}) {
  const block = { type: "toolCall", toolCallId: "fork-test", toolName, input: { path: "demo.ts", content: "file-body", command: "echo hello" } };
  const result = { role: "toolResult", toolCallId: block.toolCallId, content: [{ type: "text", text: "result-body" }], isError: error };
  return renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(ForkToolActivityProvider, {
      phase: running ? { kind: "running_tools", tools: [{ id: block.toolCallId }] } : null,
      partialResults: new Map(partial ? [[block.toolCallId, result]] : []),
    }, React.createElement(MessageView, {
      message: { role: "assistant", content: [block] },
      toolResults: new Map(complete || partial ? [[block.toolCallId, result]] : []),
    }))));
}

test("write/edit/read lifecycle defaults and manual choices", () => {
  clearExpandedToolCalls();
  for (const name of ["write", "edit", "apply_patch"]) {
    assert.match(render(name), /aria-expanded="false"/);
    assert.match(render(name, { running: true }), /aria-expanded="true"/);
    assert.match(render(name, { complete: true }), /aria-expanded="false"/);
    assert.match(render(name, { complete: true, error: true }), /aria-expanded="false"/);
  }
  assert.equal(render("read", { complete: true }), "");
  setToolCallExpanded("fork-test", false);
  assert.match(render("write", { complete: true }), /aria-expanded="false"/);
  assert.match(render("bash", { running: true }), /aria-expanded="false"/);
  clearExpandedToolCalls();
});

test("expanded shell running status follows output, including silent commands", () => {
  clearExpandedToolCalls();
  for (const name of ["bash", "powershell", "exec_command"]) {
    const silent = render(name, { running: true });
    assert.match(silent, /class="fork-shell-running" role="status"/);
    assert.ok(silent.indexOf("file-body") < silent.indexOf('class="fork-shell-running"'));
    assert.equal((silent.match(/class="fork-tool-status"/g) ?? []).length, 1);
    const partial = render(name, { partial: true });
    assert.ok(partial.indexOf("result-body") < partial.indexOf('class="fork-shell-running"'));
    assert.equal((partial.match(/class="fork-tool-status"/g) ?? []).length, 1);
  }
  setToolCallExpanded("fork-test", false);
  const collapsed = render("bash", { running: true });
  assert.doesNotMatch(collapsed, /fork-shell-running/);
  assert.match(collapsed, /Running/);
  clearExpandedToolCalls();
  const failed = render("bash", { complete: true, error: true });
  assert.doesNotMatch(failed, /fork-shell-running/);
  assert.match(failed, /Failed/);
  const write = render("write", { running: true });
  assert.doesNotMatch(write, /fork-shell-running/);
  assert.match(write, /Running/);
});

test("shell opens at start even before output and partial output is not success", () => {
  clearExpandedToolCalls();
  assert.match(render("bash"), /aria-expanded="false"/);
  const started = render("bash", { running: true });
  assert.match(started, /aria-expanded="true"/);
  assert.match(started, /aria-busy="true"/);
  assert.match(started, /Running/);
  const partial = render("bash", { partial: true });
  assert.match(partial, /data-state="running"/);
  assert.match(partial, /result-body/);
  const done = render("bash", { complete: true });
  assert.equal(done, "");
  assert.match(render("bash", { complete: true, error: true }), /Failed/);
});
