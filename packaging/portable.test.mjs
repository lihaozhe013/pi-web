import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { artifactName } from "./portable.mjs";

// The actual extracted-archive runtime smoke test is mandatory in packagePortable.
test("portable artifact names identify platform, architecture and Linux libc", () => {
  assert.equal(artifactName("0.12.2", "linux", "x64"), "pi-web-0.12.2-linux-x64-glibc");
  assert.equal(artifactName("0.12.2", "linux", "arm64"), "pi-web-0.12.2-linux-arm64-glibc");
  assert.equal(artifactName("0.12.2", "win32", "x64"), "pi-web-0.12.2-win32-x64");
  assert.equal(artifactName("0.12.2-fork.1", "darwin", "arm64"), "pi-web-0.12.2-fork.1-darwin-arm64");
});

test("reject ambiguous or unsafe artifact names", () => {
  assert.throws(() => artifactName("../secret", "linux", "x64"), /Invalid/);
  assert.throws(() => artifactName("1.0.0", "freebsd", "x64"), /Unsupported/);
  assert.throws(() => artifactName("1.0.0", "linux", "ia32"), /Unsupported/);
});

test("PTY probe exits despite retained handles, but still rejects missing output", async () => {
  const app = await mkdtemp(join(tmpdir(), "portable-probe-test-"));
  try {
    const moduleDir = join(app, "node_modules", "node-pty");
    await mkdir(moduleDir, { recursive: true });
    await writeFile(join(app, "package.json"), "{}");
    for (const valid of [true, false]) {
      // Simulate ConPTY retaining a handle even after the child has exited.
      await writeFile(join(moduleDir, "index.js"), `
        exports.spawn = () => {
          setInterval(() => {}, 1000);
          return {
            pid: 123,
            onData: cb => queueMicrotask(() => cb(${JSON.stringify(valid ? "portable-pty-ok" : "wrong output")})),
            onExit: cb => queueMicrotask(() => cb({ exitCode: 0 }))
          };
        };
      `);
      const probe = fileURLToPath(new URL("./pty-probe.mjs", import.meta.url));
      const result = spawnSync(process.execPath, [probe, app], { encoding: "utf8", timeout: 5000 });
      assert.ifError(result.error);
      assert.equal(result.status, valid ? 0 : 1, result.stdout + result.stderr);
      assert.match(result.stdout, valid ? /PASS/ : /FAIL/);
    }
  } finally {
    await rm(app, { recursive: true, force: true });
  }
});

test("portable packaging keeps Node.js runtime commands and local-only packaging", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.release, undefined);
  assert.equal(pkg.scripts.start, "node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 30141");
  assert.equal(pkg.scripts["package:portable"], "node packaging/portable.mjs");
  assert.ok(pkg.files.includes("bin") && pkg.files.includes(".next"));
});
