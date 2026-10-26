import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { toolPathLanguage, shellToolLanguage, toolCodeLanguage, toolPath } = await jiti.import(
  "@/lib/tool-code-language",
);

test("a coding tool's file picks the syntax of its extension", () => {
  assert.equal(toolCodeLanguage("read", { path: "src/app.tsx" }), "tsx");
  assert.equal(toolCodeLanguage("write", { path: "lib/util.py", content: "x = 1" }), "python");
  assert.equal(toolCodeLanguage("edit", { path: "src/main.rs", edits: [] }), "rust");
  assert.equal(toolCodeLanguage("write_file", { file_path: "/a/b/c.yaml" }), "yaml");
  assert.equal(toolCodeLanguage("read", { filePath: "C:\\repo\\mod.go" }), "go");
  assert.equal(toolCodeLanguage("read", { path: "notes.md" }), "markdown");
  assert.equal(toolCodeLanguage("read", { path: "package.json" }), "json");
});

test("a file name that is the whole syntax wins over its extension", () => {
  assert.equal(toolPathLanguage("Dockerfile"), "docker");
  assert.equal(toolPathLanguage("build/Makefile"), "makefile");
  assert.equal(toolPathLanguage("CMakeLists.txt"), "cmake");
  assert.equal(toolPathLanguage(".env"), "bash");
  assert.equal(toolPathLanguage(".gitignore"), "git");
  assert.equal(toolPathLanguage("config/.editorconfig"), "ini");
});

test("a shell tool's command is a shell script", () => {
  assert.equal(shellToolLanguage("bash"), "bash");
  assert.equal(shellToolLanguage("bash (local)"), "bash");
  assert.equal(shellToolLanguage("powershell"), "powershell");
  assert.equal(shellToolLanguage("pwsh"), "powershell");
  assert.equal(shellToolLanguage("cmd"), "batch");
  for (const name of ["bash", "shell", "powershell", "mcp__box__shell", "box.run_command"]) {
    assert.notEqual(toolCodeLanguage(name, { command: "ls" }), undefined, name);
  }
});

test("a text without a known syntax stays plain", () => {
  assert.equal(toolPathLanguage("README"), undefined);
  assert.equal(toolPathLanguage("notes.xyz"), undefined);
  assert.equal(toolPathLanguage("src/archive/"), undefined);
  assert.equal(toolPathLanguage(undefined), undefined);
  assert.equal(toolPathLanguage(42), undefined);
  // Not a file, whatever the arguments say.
  assert.equal(toolCodeLanguage("grep", { pattern: "path: a.ts" }), undefined);
  assert.equal(toolCodeLanguage("webfetch", { url: "https://example.com/a.ts" }), undefined);
  assert.equal(toolCodeLanguage("read", {}), undefined);
  assert.equal(toolCodeLanguage("read", { path: "" }), undefined);
});

test("the file an argument names is found under the names tools use", () => {
  assert.equal(toolPath({ path: "a.ts" }), "a.ts");
  assert.equal(toolPath({ file_path: "b.ts", path: undefined }), "b.ts");
  assert.equal(toolPath({ filePath: "c.ts" }), "c.ts");
  assert.equal(toolPath({ target_file: "d.ts" }), "d.ts");
  assert.equal(toolPath({ file: "e.ts" }), "e.ts");
  assert.equal(toolPath({ nope: "f.ts" }), undefined);
  assert.equal(toolPath(null), undefined);
});
