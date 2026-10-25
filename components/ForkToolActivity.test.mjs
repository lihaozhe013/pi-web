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
    assert.match(render(name, { running: true }), /aria-expanded="false"/);
    assert.match(render(name, { complete: true }), /aria-expanded="true"/);
    assert.match(render(name, { complete: true, error: true }), /aria-expanded="false"/);
  }
  assert.match(render("read", { complete: true }), /aria-expanded="false"/);
  setToolCallExpanded("fork-test", false);
  assert.match(render("write", { complete: true }), /aria-expanded="false"/);
  assert.match(render("bash", { running: true }), /aria-expanded="false"/);
  clearExpandedToolCalls();
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
  assert.match(done, /Succeeded/);
  assert.match(done, /aria-busy="false"/);
  assert.match(render("bash", { complete: true, error: true }), /Failed/);
});
