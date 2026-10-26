Pi Web portable package

Personal-use build of a minimal GUI for the Pi coding agent. There is no
automated release service or self-updater.

Prerequisite: Node.js 22.19.0 or newer on PATH. Bun is needed to build, not to
run this archive. Use the archive matching your operating system, CPU, and Linux
libc.

From the extracted directory:
  node bin/pi-web.js --no-open
  node bin/pi-web.js --no-open --port 30141 --hostname 127.0.0.1
  node bin/pi-web.js --help

The application directory must be writable (startup rotates preview secrets).
Keep the complete directory, including hidden .next and node_modules. Do not
replace the bundled Next.js or copy node_modules between platforms. Build and
test locally with Bun 1.4.4 and Node.js 22.19.0 or newer.

Linux packages target glibc, not Alpine/musl. Cross-platform certification is
not provided. Native dependencies may require system libraries.

For remote access, prefer SSH forwarding:
  ssh -N -L 30141:127.0.0.1:30141 user@server
Then visit http://127.0.0.1:30141 locally. Do not expose an unauthenticated
server to the public internet.

To update, stop the old process, extract a replacement archive into a new
directory, and start it there. Back up Pi configuration and sessions first;
they remain outside this package in the normal user data directory.

Git, shells, Python, npm/npx, and external MCP tools are not bundled. Features
that need them require those tools to be installed separately.

PORTABLE.json records the build platform, runtime versions, and source commit.
