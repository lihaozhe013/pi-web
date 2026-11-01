// Local portable packaging with Bun for dependencies and Node.js for runtime.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { smokeTest } from './smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function artifactName(version, platform = process.platform, arch = process.arch) {
  if (!/^[\w.+-]+$/.test(version)) throw new Error('Invalid package version');
  if (!['linux', 'darwin', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    throw new Error(`Unsupported target: ${platform}-${arch}`);
  }
  // Linux releases target glibc, not Alpine/musl.
  return `pie-${version}-${platform}-${arch}${platform === 'linux' ? '-glibc' : ''}`;
}

/**
 * Remove files the running server never reads: source maps, the image optimizer
 * binary, and Next.js documentation. Source maps only matter for stack traces
 * with `--enable-source-maps`; Next.js's own `.next` maps are already outside
 * the package allow-list.
 *
 * `@next/swc` must stay: when it is missing, Next.js downloads the bindings at
 * startup into `next/next-swc-fallback`, which needs network access and roughly
 * 190 MiB of the user's disk.
 */
export async function pruneRuntime(appDir) {
  const nodeModules = join(appDir, 'node_modules');
  await assertNextSwc(nodeModules);
  const maps = await removeSourceMaps(nodeModules, { files: 0, bytes: 0 });
  await rm(join(nodeModules, '@img'), { recursive: true, force: true });
  await rm(join(nodeModules, 'next', 'dist', 'docs'), { recursive: true, force: true });
  return maps;
}

async function assertNextSwc(nodeModules) {
  let entries = [];
  try {
    entries = await readdir(join(nodeModules, '@next'));
  } catch {
    /* Reported below. */
  }
  if (!entries.some((entry) => entry.startsWith('swc-'))) {
    throw new Error(
      'The production install has no @next/swc binary. Next.js would download it at startup, so packaging stops here.'
    );
  }
}

async function removeSourceMaps(dir, removed) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    // Never follow symlinks: `.bin` entries point outside the tree and the maps
    // are always regular files inside it.
    if (entry.isDirectory()) {
      await removeSourceMaps(path, removed);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.map')) continue;
    const { size } = await stat(path);
    await rm(path, { force: true });
    removed.files += 1;
    removed.bytes += size;
  }
  return removed;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, cwd, capture = false, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
  return result.stdout;
}

export async function packagePortable(output = join(root, 'build', 'portable')) {
  return buildPortableArchive({ output });
}

/**
 * Build the portable archive and return what it contains. The desktop shell
 * reuses this pipeline as its payload, so the options stay limited to an output
 * directory and extra build environment.
 */
export async function buildPortableArchive({
  output = join(root, 'build', 'portable'),
  env: buildEnv = {}
} = {}) {
  // Bun sets npm_execpath to its native executable when running package scripts.
  // Spawn it directly, keeping process.execPath reserved for Node.js.
  const bunCli = process.env.npm_execpath;
  if (!bunCli || !/^bun(?:\.exe)?$/i.test(bunCli.split(/[\\/]/).pop())) {
    throw new Error('Run via: bun run package:portable');
  }
  const bun = (args, cwd, env) => run(bunCli, args, cwd, false, env);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  // The build copy has no .git, so the commit goes to the build as an env var
  // and the web version shows it (`0.1.0+1c02256`).
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  }).trim();
  const name = artifactName(pkg.version);
  if (process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime) {
    throw new Error('Linux portable packages currently require glibc (musl is not supported)');
  }
  const work = await mkdtemp(join(tmpdir(), 'pie-portable-'));
  output = resolve(output);
  try {
    const source = join(work, 'source');
    const packed = join(work, 'packed');
    const staging = join(work, 'staging');
    await Promise.all(
      [source, packed, staging, output].map((dir) => mkdir(dir, { recursive: true }))
    );

    // Copy tracked working-tree files only: never copy .env, sessions, node_modules
    // or the active dev .next. Commit/add new application files before packaging.
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
    const files = new Set([...tracked, 'bun.lock']);
    for (const file of files) {
      const destination = join(source, file);
      await mkdir(dirname(destination), { recursive: true });
      try {
        await cp(join(root, file), destination, { recursive: true });
      } catch (error) {
        if (error.code !== 'ENOENT' || file === 'bun.lock') throw error;
      }
    }
    bun(['install', '--frozen-lockfile'], source);
    bun(['run', 'build'], source, { ...process.env, PIE_COMMIT: commit, ...buildEnv });

    // Reuse package.json.files as the archive allow-list. This does not publish.
    bun(['pm', 'pack', '--filename', join(packed, 'app.tgz')], source);
    // Relative archive paths avoid GNU tar interpreting Windows C: as a remote host.
    run('tar', ['-xzf', 'packed/app.tgz', '-C', 'staging'], work);
    const app = join(staging, 'pie');
    await rename(join(staging, 'package'), app);
    // `bun pm pack` never includes nested node_modules directories, but Next 16
    // keeps external-package shims in `.next/node_modules` as symlinks into the
    // package's own node_modules, which the production install below recreates.
    // Without them `next start` fails to load the instrumentation hook.
    const shims = join(source, '.next', 'node_modules');
    if (await exists(shims)) {
      await cp(shims, join(app, '.next', 'node_modules'), {
        recursive: true,
        verbatimSymlinks: true,
        force: true
      });
    }
    await cp(join(source, 'bun.lock'), join(app, 'bun.lock'));
    // Install on the target OS/architecture so optional/native dependencies match.
    bun(['install', '--frozen-lockfile', '--production'], app);
    // Trim what `next start` never reads. Pruning before the archive is written
    // means the smoke test below validates the pruned tree.
    const pruned = await pruneRuntime(app);
    console.log(
      `Pruned ${pruned.files} source maps (${(pruned.bytes / 1024 / 1024).toFixed(1)} MiB), sharp, and Next.js docs.`
    );
    await writeFile(
      join(app, 'PORTABLE.json'),
      JSON.stringify(
        {
          version: pkg.version,
          platform: process.platform,
          arch: process.arch,
          libc: process.platform === 'linux' ? 'glibc' : undefined,
          buildNode: process.version,
          buildBun: run(bunCli, ['--version'], source, true).trim(),
          commit,
          source: 'tracked working-tree files (may include local changes)'
        },
        null,
        2
      ) + '\n'
    );
    await cp(join(root, 'packaging', 'PORTABLE-README.txt'), join(app, 'PORTABLE-README.txt'));

    const archive = join(work, `${name}.tar.gz`);
    run('tar', ['-czf', `${name}.tar.gz`, '-C', 'staging', 'pie'], work);
    // Test the actual archive after extraction into a different path, not the build tree.
    const check = join(work, 'extracted with spaces');
    await mkdir(check);
    run('tar', ['-xzf', `${name}.tar.gz`, '-C', 'extracted with spaces'], work);
    await smokeTest(join(check, 'pie'));
    const hash = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
    await cp(archive, join(output, `${name}.tar.gz`));
    await writeFile(join(output, `${name}.tar.gz.sha256`), `${hash}  ${name}.tar.gz\n`);
    console.log(`Portable archive: ${join(output, `${name}.tar.gz`)}`);
    return {
      archive: join(output, `${name}.tar.gz`),
      name,
      version: pkg.version,
      commit,
      sha256: hash,
      bytes: (await stat(archive)).size
    };
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
