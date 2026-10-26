# Local Portable Packaging

Build and test portable archives locally. There is no CI, public release pipeline, or npm publication step.

## Requirements

The build machine needs Git, Bun 1.4.4, Node.js satisfying `package.json.engines`, and gzip-capable `tar`. Build for the same operating system and architecture as the target. Linux packages require glibc; Alpine/musl and cross-compilation are unsupported.

```sh
bun install --frozen-lockfile
bun run test:portable
bun run package:portable
# Optional output directory:
bun run package:portable /path/to/output
```

The target needs Node.js, not Bun or a dependency installation. External tools invoked by agents, extensions, or MCP servers are not bundled.

## Build process

The packager copies Git-tracked working-tree files, including local modifications, into a temporary source directory. Add new files to Git before packaging. Deleted files are skipped and the required `bun.lock` is copied.

It installs frozen dependencies, builds outside the development checkout, packs using the package file allow-list, and installs production dependencies in isolation. The final archive contains `.next` and complete production `node_modules`; it does not use Next.js standalone output.

Before saving the archive and SHA-256 checksum, the packager extracts it to another path containing spaces and smoke-tests the launcher, homepage, static assets, and sessions API. Output defaults to `build/portable/`. Temporary directories are cleaned up afterward. Registry access is needed during packaging.

`PORTABLE.json` records the version, commit, platform, and actual Node.js and Bun versions. Commit first when a reproducible source reference matters: the commit alone cannot reconstruct uncommitted modifications.

## Run

Extract the archive, enter its `pi-web` directory, then run:

```sh
node bin/pi-web.js --no-open
```

Open <http://127.0.0.1:30141>. Verify the supplied checksum before extraction, using `sha256sum` or macOS `shasum -a 256`. Preserve hidden `.next` files and all of `node_modules`. The installation must be writable for launcher preview-secret rotation.

For remote access, prefer SSH forwarding:

```sh
ssh -N -L 30141:127.0.0.1:30141 user@server
```

## Updates and limitations

Stop the old instance, extract the replacement to a new directory, and start it there. Keep the old directory for rollback and back up user configuration and sessions. Do not replace build files in a running installation or copy native dependencies between platforms.

Smoke tests verify the build platform, not every provider, OAuth flow, MCP server, or extension. Git, shells, Python, npm/npx, and external MCP programs must be provided separately when needed. Historical plugin and skill installers may still require npm/npx.
