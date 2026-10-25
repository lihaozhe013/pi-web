import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { forkPathLanguage, forkShellLanguage, forkToolLanguage, forkToolPath } = await jiti.import(
  "@/lib/fork-code-language",
);

test("a coding tool's file picks the syntax of its extension", () => {
  assert.equal(forkToolLanguage("read", { path: "src/app.tsx" }), "tsx");
  assert.equal(forkToolLanguage("write", { path: "lib/util.py", content: "x = 1" }), "python");
  assert.equal(forkToolLanguage("edit", { path: "src/main.rs", edits: [] }), "rust");
  assert.equal(forkToolLanguage("write_file", { file_path: "/a/b/c.yaml" }), "yaml");
  assert.equal(forkToolLanguage("read", { filePath: "C:\\repo\\mod.go" }), "go");
  assert.equal(forkToolLanguage("read", { path: "notes.md" }), "markdown");
  assert.equal(forkToolLanguage("read", { path: "package.json" }), "json");
});

test("a file name that is the whole syntax wins over its extension", () => {
  assert.equal(forkPathLanguage("Dockerfile"), "docker");
  assert.equal(forkPathLanguage("build/Makefile"), "makefile");
  assert.equal(forkPathLanguage("CMakeLists.txt"), "cmake");
  assert.equal(forkPathLanguage(".env"), "bash");
  assert.equal(forkPathLanguage(".gitignore"), "git");
  assert.equal(forkPathLanguage("config/.editorconfig"), "ini");
});

test("a shell tool's command is a shell script", () => {
  assert.equal(forkShellLanguage("bash"), "bash");
  assert.equal(forkShellLanguage("bash (local)"), "bash");
  assert.equal(forkShellLanguage("powershell"), "powershell");
  assert.equal(forkShellLanguage("pwsh"), "powershell");
  assert.equal(forkShellLanguage("cmd"), "batch");
  for (const name of ["bash", "shell", "powershell", "mcp__box__shell", "box.run_command"]) {
    assert.notEqual(forkToolLanguage(name, { command: "ls" }), undefined, name);
  }
});

test("a text without a known syntax stays plain", () => {
  assert.equal(forkPathLanguage("README"), undefined);
  assert.equal(forkPathLanguage("notes.xyz"), undefined);
  assert.equal(forkPathLanguage("src/archive/"), undefined);
  assert.equal(forkPathLanguage(undefined), undefined);
  assert.equal(forkPathLanguage(42), undefined);
  // Not a file, whatever the arguments say.
  assert.equal(forkToolLanguage("grep", { pattern: "path: a.ts" }), undefined);
  assert.equal(forkToolLanguage("webfetch", { url: "https://example.com/a.ts" }), undefined);
  assert.equal(forkToolLanguage("read", {}), undefined);
  assert.equal(forkToolLanguage("read", { path: "" }), undefined);
});

test("the file an argument names is found under the names tools use", () => {
  assert.equal(forkToolPath({ path: "a.ts" }), "a.ts");
  assert.equal(forkToolPath({ file_path: "b.ts", path: undefined }), "b.ts");
  assert.equal(forkToolPath({ filePath: "c.ts" }), "c.ts");
  assert.equal(forkToolPath({ target_file: "d.ts" }), "d.ts");
  assert.equal(forkToolPath({ file: "e.ts" }), "e.ts");
  assert.equal(forkToolPath({ nope: "f.ts" }), undefined);
  assert.equal(forkToolPath(null), undefined);
});
