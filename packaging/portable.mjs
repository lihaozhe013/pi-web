// fork: portable distribution without changing the upstream runtime or npm release.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { smokeTest } from "./smoke.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function artifactName(version, platform = process.platform, arch = process.arch) {
  if (!/^[\w.+-]+$/.test(version)) throw new Error("Invalid package version");
  if (!["linux", "darwin", "win32"].includes(platform) || !["x64", "arm64"].includes(arch)) {
    throw new Error(`Unsupported target: ${platform}-${arch}`);
  }
  // Linux releases target glibc, not Alpine/musl.
  return `pi-web-${version}-${platform}-${arch}${platform === "linux" ? "-glibc" : ""}`;
}

export function parsePackResult(stdout, packageName) {
  const result = JSON.parse(stdout);
  // npm 10/11 return an array; npm 12 returns { [packageName]: tarball }.
  const tarball = Array.isArray(result) ? result[0] : result?.[packageName];
  if (!tarball || typeof tarball.filename !== "string" ||
      !/^[\w.@+-]+\.tgz$/.test(tarball.filename)) {
    throw new Error("Unexpected npm pack --json output: missing or invalid tarball filename");
  }
  return tarball;
}

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
  return result.stdout;
}

export async function packagePortable(output = join(root, "build", "portable")) {
  // npm run provides the real npm JS entry, avoiding npm.cmd/shell quoting on Windows.
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run via: npm run package:portable");
  const npm = (args, cwd, capture = false) => run(process.execPath, [npmCli, ...args], cwd, capture);
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const name = artifactName(pkg.version);
  if (process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime) {
    throw new Error("Linux portable packages currently require glibc (musl is not supported)");
  }
  const work = await mkdtemp(join(tmpdir(), "pi-web-portable-"));
  output = resolve(output);
  try {
    const source = join(work, "source");
    const packed = join(work, "packed");
    const staging = join(work, "staging");
    await Promise.all([source, packed, staging, output].map((dir) => mkdir(dir, { recursive: true })));

    // Copy tracked working-tree files only: never copy .env, sessions, node_modules
    // or the active dev .next. Commit/add new application files before packaging.
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
    for (const file of files) {
      const destination = join(source, file);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(root, file), destination, { recursive: true });
    }
    npm(["ci", "--no-audit", "--no-fund"], source);
    npm(["run", "build"], source);

    // Reuse upstream's npm file allow-list, not a second hand-maintained list.
    // npm pack does NOT publish and does NOT include node_modules.
    const tarball = parsePackResult(npm(["pack", "--json", "--pack-destination", packed], source, true), pkg.name);
    // Relative archive paths avoid GNU tar interpreting Windows C: as a remote host.
    run("tar", ["-xzf", `packed/${tarball.filename}`, "-C", "staging"], work);
    const app = join(staging, "pi-web");
    await rename(join(staging, "package"), app);
    await cp(join(source, "package-lock.json"), join(app, "package-lock.json"));
    // Install on the target OS/architecture so optional/native dependencies match.
    npm(["ci", "--omit=dev", "--no-audit", "--no-fund"], app);
    await writeFile(join(app, "PORTABLE.json"), JSON.stringify({
      version: pkg.version,
      platform: process.platform,
      arch: process.arch,
      libc: process.platform === "linux" ? "glibc" : undefined,
      buildNode: process.version,
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      source: "tracked working-tree files (may include local changes)",
    }, null, 2) + "\n");
    await cp(join(root, "packaging", "PORTABLE-README.txt"), join(app, "PORTABLE-README.txt"));

    const archive = join(work, `${name}.tar.gz`);
    run("tar", ["-czf", `${name}.tar.gz`, "-C", "staging", "pi-web"], work);
    // Test the actual archive after extraction into a different path, not the build tree.
    const check = join(work, "extracted with spaces");
    await mkdir(check);
    run("tar", ["-xzf", `${name}.tar.gz`, "-C", "extracted with spaces"], work);
    await smokeTest(join(check, "pi-web"));
    const hash = createHash("sha256").update(await readFile(archive)).digest("hex");
    await cp(archive, join(output, `${name}.tar.gz`));
    await writeFile(join(output, `${name}.tar.gz.sha256`), `${hash}  ${name}.tar.gz\n`);
    console.log(`Portable archive: ${join(output, `${name}.tar.gz`)}`);
  } finally {
    await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  packagePortable(process.argv[2]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
