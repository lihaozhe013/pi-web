import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

export async function smokeTest(app) {
  const home = await mkdtemp(join(tmpdir(), "pi-web-smoke-"));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PI_CODING_AGENT_DIR: join(home, "agent"),
    PI_WEB_PASSWORD: "",
    PI_WEB_ALLOWED_HOSTS: "",
  };
  let child;
  let exited;
  let log = "";
  try {
    execFileSync(process.execPath, ["bin/pi-web.js", "--help"], { cwd: app, env, timeout: 15000 });
    const port = await freePort();
    child = spawn(process.execPath, ["bin/pi-web.js", "--no-open", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: app, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
    });
    exited = new Promise((resolve) => child.once("exit", resolve));
    child.on("error", (error) => { log += error.message; });
    child.stdout.on("data", (data) => { log += data; });
    child.stderr.on("data", (data) => { log += data; });
    const base = `http://127.0.0.1:${port}`;
    let html;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Server exited:\n${log}`);
      try {
        const response = await fetch(base, { signal: AbortSignal.timeout(2000) });
        if (response.ok) { html = await response.text(); break; }
      } catch { /* Wait for Next to listen. */ }
      await sleep(500);
    }
    assert.ok(html, `Server did not become ready:\n${log}`);
    const asset = html.match(/(?:src|href)="([^"\s]*\/_next\/static\/[^"\s]+)"/)?.[1];
    assert.ok(asset, "HTML should reference a Next static asset");
    assert.equal((await fetch(new URL(asset.replaceAll("&amp;", "&"), base), { signal: AbortSignal.timeout(10000) })).status, 200);
    const sessions = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(15000) });
    assert.equal(sessions.status, 200, await sessions.text());
    assert.ok(!log.includes("could not rotate"), log);
    console.log("Portable smoke test passed: launcher, PTY, HTTP, static asset, sessions API.");
  } finally {
    if (child?.pid) {
      if (process.platform === "win32") {
        try { execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* Already exited. */ }
      } else {
        try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
        await Promise.race([exited, sleep(7000)]);
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
      }
      await Promise.race([exited, sleep(3000)]);
    }
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
  }
}
