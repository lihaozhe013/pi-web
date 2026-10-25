Pi Web portable package (personal fork)

Prerequisite: latest Node.js LTS on PATH. No global Next.js, npm install,
Bun, Docker or npm registry publication is needed on the target machine.
Use the archive matching your operating system, CPU and Linux libc.

From this extracted directory:
  node bin/pi-web.js --no-open
  node bin/pi-web.js --no-open --port 30141 --hostname 127.0.0.1
  node bin/pi-web.js --help

Linux/macOS environment example (disable upstream update checks):
  PI_WEB_SKIP_VERSION_CHECK=1 node bin/pi-web.js --no-open

The application directory must be writable (startup rotates preview secrets).
Keep the complete directory, including hidden .next and node_modules.
Do not replace the bundled Next.js or copy node_modules between platforms.
CI builds/tests with the latest Node.js LTS (lts/*), not a pinned major.
PORTABLE.json records the actual build Node version for troubleshooting.
Linux packages target glibc, NOT Alpine/musl. See the source packaging/README.md
for build runner baselines. Native dependencies may require system libraries.

For remote access, prefer SSH forwarding:
  ssh -N -L 30141:127.0.0.1:30141 user@server
Then visit http://127.0.0.1:30141 on your own computer.
Do not expose an unauthenticated server to the public internet.

Update by stopping the old process, extracting a new release to a new directory,
and starting it there. The upstream `update` subcommand updates global npm
installations; it does NOT update these portable packages.
Sessions/configuration stay in the normal user data directory, outside this
package. Back up that data before upgrading. Do not delete it when updating.

Git, shells, Python, npm/npx and external MCP tools are NOT bundled. Features
that require them need those tools installed separately. Node distributions
usually include npm/npx; keep them installed for plugin/skill installation.
PORTABLE.json records the build platform, Node version and source commit.
