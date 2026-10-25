// Run in a disposable process: Windows ConPTY can retain native handles after exit.
import { writeSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const report = (message) => writeSync(1, `[portable PTY] ${message}\n`);
let terminal;
let timer;
function finish(code, message) {
  report(message);
  clearTimeout(timer);
  // This probe owns no application state. Explicit exit prevents native handles
  // from keeping a successful probe alive; the packaged server is not affected.
  process.exit(code);
}

try {
  const app = resolve(process.argv[2]);
  report(`Loading node-pty (Node ${process.version}, ${process.platform}-${process.arch})`);
  const require = createRequire(join(app, "package.json"));
  const pty = require("node-pty");
  let output = "";
  timer = setTimeout(() => finish(1, `Timed out waiting for PTY exit; output=${JSON.stringify(output)}`), 10000);
  report("Spawning PTY child");
  terminal = pty.spawn(process.execPath, ["-e", 'console.log("portable-pty-ok")'], {
    name: "xterm-color", cols: 80, rows: 24, cwd: app, env: process.env,
  });
  report(`PTY created (pid ${terminal.pid})`);
  terminal.onData((data) => {
    output += data;
    if (output.length > 16384) output = output.slice(-16384);
  });
  terminal.onExit((event) => {
    const ok = event.exitCode === 0 && output.includes("portable-pty-ok");
    finish(ok ? 0 : 1, `PTY exited: code=${event.exitCode}; output=${JSON.stringify(output)}; ${ok ? "PASS" : "FAIL"}`);
  });
} catch (error) {
  finish(1, error.stack ?? String(error));
}
