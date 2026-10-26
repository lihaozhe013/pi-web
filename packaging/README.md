# Local portable packaging

This personal fork builds and tests locally. It has no CI, automated release
pipeline, or npm publication step. `main` is maintained independently of upstream.

## Commands and requirements

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start development in the current `.next` directory |
| `bun run start` | Start an existing production build with Node.js |
| `node bin/pi-web.js --no-open` | Start through the Node.js CLI launcher |
| `bun run test:portable` | Run packaging unit tests |
| `bun run package:portable` | Build, package, and smoke-test in temporary directories |

The build machine needs Git, Bun 1.4.4, a current Node.js LTS satisfying
`package.json.engines`, gzip-capable `tar`, and any native build tools needed by
`node-pty`. Build on the target operating system and architecture. Linux packages
require glibc; Alpine/musl and cross-compilation are unsupported.

```sh
bun install --frozen-lockfile
bun run test:portable
bun run package:portable
# Optional output directory:
bun run package:portable /path/to/output
```

The target machine only needs Node.js to start the app. Next.js and production
dependencies are bundled. Bun is required for building, not for running the archive.

## Packaging process

1. Copy Git-tracked working-tree files into a temporary source directory, including
   local changes. Add new application files to Git before packaging. Deleted files
   are skipped, and the required `bun.lock` is always copied.
2. Run `bun install --frozen-lockfile` and `bun run build` in that directory.
   The current checkout's `.next` remains untouched.
3. Run `bun pm pack`, reusing the `package.json.files` allow-list without publishing.
4. Extract the package, copy `bun.lock`, and run
   `bun install --frozen-lockfile --production` for the target platform. Trusted
   native dependency scripts run under Node.js.
5. Create a tar.gz with complete production `node_modules`, then extract it to a
   different path containing spaces.
6. Smoke-test the CLI, a real PTY subprocess, the HTTP homepage, static assets,
   and sessions API before saving the archive and SHA-256 checksum.

Output defaults to the ignored `build/portable/` directory. Temporary directories
are cleaned up on success or failure. Installation needs registry access; starting
the extracted archive needs no dependency installation. Full dependencies are
intentional; this does not use Next.js standalone output.

`PORTABLE.json` records the version, commit, platform, and actual Node.js and Bun
build versions. Commit changes first when you need a reproducible source reference:
the recorded commit cannot reconstruct uncommitted working-tree changes.

## Run on the target machine

```sh
# Linux x64 example; use the actual archive version.
sha256sum -c pi-web-0.12.2-linux-x64-glibc.tar.gz.sha256
tar -xzf pi-web-0.12.2-linux-x64-glibc.tar.gz
cd pi-web
node bin/pi-web.js --no-open
```

Windows can use the same `tar` and Node.js commands. On macOS, use
`shasum -a 256` for checksums. Preserve the hidden `.next` directory and complete
`node_modules`. The installation must be writable so the launcher can rotate
preview secrets.

The default address is `127.0.0.1:30141`. For a remote server, forward it over SSH:

```sh
ssh -N -L 30141:127.0.0.1:30141 user@server
```

Open `http://127.0.0.1:30141` locally. Use a process manager such as systemd when
background operation is needed; point it at `bin/pi-web.js` in the installation.

## Validation and updates

Run the native PTY probe independently when investigating a dependency problem:

```sh
node packaging/pty-probe.mjs .
```

The probe checks module loading, spawning, output, and exit. It exits explicitly
after success to avoid retained Windows ConPTY handles causing a false timeout.
Smoke tests cover the current build platform; OAuth, models, MCP, and third-party
plugins still need validation for their actual use.

Stop the old instance, extract a new archive to a new directory, and start it there.
Keep the old directory for rollback and back up user sessions and settings. Do not
replace `.next` or `node_modules` in a running installation or copy native modules
between platforms.

The inherited CLI `update` command targets global upstream npm installations and
does not update portable packages. Set `PI_WEB_SKIP_VERSION_CHECK=1` to suppress
upstream version checks when needed. Git, Node.js, shells, Python, npm/npx, and
external MCP programs are not bundled. Existing plugin and skill installation
features may still require npm/npx from the Node.js installation.
