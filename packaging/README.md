# Local Portable Packaging

Build portable archives locally. There is no CI, public release pipeline, or npm publication step.

## Requirements

The build machine needs Git, the latest Bun release, the latest Node.js LTS release, and
gzip-capable `tar`. Build for the same operating system and architecture as the target. Linux
packages require glibc; Alpine/musl and cross-compilation are unsupported.

```sh
bun install --frozen-lockfile
bun run package:portable
# Optional output directory:
bun run package:portable /path/to/output
```

The target needs Node.js, not Bun or a dependency installation. External tools invoked by agents,
extensions, or MCP servers are not bundled.

## Build process

The packager copies Git-tracked working-tree files, including local modifications, into a temporary
source directory. Add new files to Git before packaging. Deleted files are skipped and the required
`bun.lock` is copied.

It installs frozen dependencies, builds outside the development checkout (`vite build` for the
interface, `vite build --config vite.server.config.mts` for the server bundle), packs using the
package file allow-list, and installs production dependencies in isolation. That production tree is
then pruned of files the server never reads: source maps. The temporary source copy has no `.git`,
so the packager forwards the source commit as `PIE_COMMIT` and the build's version carries its short
form (`0.1.0+1c02256`). The final archive contains `dist`, `build/server`, and complete production
`node_modules`.

Output defaults to `build/portable/`. Temporary directories are cleaned up afterward. Registry
access is needed during packaging.

`PORTABLE.json` records the version, commit, platform, and actual Node.js and Bun versions. Commit
first when a reproducible source reference matters: the commit alone cannot reconstruct uncommitted
modifications.

## Run

Extract the archive, enter its `pie` directory, then run:

```sh
node bin/pie.js --no-open
```

Open <http://127.0.0.1:30141>. Verify the supplied checksum before extraction, using `sha256sum` or
macOS `shasum -a 256`. Keep the whole directory and all of `node_modules` together. The installation
must be writable for the launcher's state files.

For remote access, prefer SSH forwarding:

```sh
ssh -N -L 30141:127.0.0.1:30141 user@server
```

## Updates and limitations

Stop the old instance, extract the replacement to a new directory, and start it there. Keep the old
directory for rollback and back up user configuration and sessions. Do not replace build files in a
running installation or copy native dependencies between platforms.

The build is not verified automatically: check the packaged interface, a session round trip, and
the API the build is going to serve. Git, shells, Python, npm/npx, and external MCP programs must be
provided separately when needed. Historical plugin and skill installers may still require npm/npx.

## Desktop shell

The archive is also the payload of the Tauri 2 shell in `src-tauri/`. `bun run desktop:build` runs
this pipeline, writes `build/desktop/payload.tar.gz` and `payload.json`, builds the shell, and
packages the host platform; `--payload <archive>` reuses an existing archive. The payload is rebuilt
with `VITE_PIE_DESKTOP=1` so the service worker stays unregistered in a webview. See
[desktop shell](../docs/desktop.md) for the runtime contract.
