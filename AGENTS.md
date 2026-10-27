# Pi Web — Agent Instructions

## Product direction

An independently maintained, minimal Pi GUI for personal, local use. This project no longer tracks
or merges its source project. Make everyday Pi conversations and execution clear, attractive, and
convenient; do not build an all-in-one manager.

Read [project direction](docs/README.md) and [interface principles](docs/design.md) before changing
the product. Read [architecture](docs/architecture.md) for core changes and
[cleanup](docs/cleanup.md) for integration work.

## Documentation language

All project documentation must be written and maintained in English, including this file, README
files, development guides, architecture notes, plans, and newly added documentation. Do not create
translated documentation copies. This requirement does not determine the language of conversations
with the owner or remove application localization.

## Decisions

- Prefer removing unnecessary features, settings, state, and dependencies. Historical existence is
  not a reason to retain something.
- Core rewrites, library replacements, file moves, and deletions are welcome when they reduce
  complexity. Keep code small, typed, and reviewable by one person.
- There is no permanent upstream layer and fork enhancement layer. Do not add `fork-*` names or
  `// fork:` markers for project-specific code.
- Session forking is a real domain concept; do not confuse it with obsolete project-fork branding.
- Pi owns agent capabilities. Do not invent a parallel agent protocol or web-only extension API.
  Consult the installed SDK's documentation and types when changing its integration.
- Do not add or restore CI / GitHub Actions, release pipelines, telemetry, or settings for
  hypothetical users.
- Do not restore file trees, file previews, Git/worktree management, terminal tabs, or the demo.
- Document the current implementation and clearly label plans. Update docs alongside code; do not
  preserve frozen historical architecture snapshots.

## Development

- Use the latest Bun release and the latest Node.js LTS release. Install with
  `bun install --frozen-lockfile`; change dependencies with `bun add` / `bun remove` and commit
  `bun.lock`.
- Pin every `@earendil-works/*` package with `bun add --exact`.
- Node.js remains the runtime. Keep explicit `node` invocations; do not use `bun --bun`.
- Use `bun run dev`, `bun run test`, `bun run typecheck`, `bun run lint`, and
  `bun run test:portable`. Do not use `bun test`.
- Never run a production build in an active development checkout: it pollutes `.next`. Portable
  packaging builds in isolation.
- Check port 30141 and reuse a healthy server before starting development. Do not start a second
  Next dev server in the same checkout.
- For HMR failures, explicitly reload first and compare server logs and HTTP responses. Only restart
  a reproducibly unhealthy server: stop the exact process, back up `.next`, then restart. Do not
  switch development to webpack as a workaround.
- Do not include Next-generated additions to this file in unrelated changes.

## Changes and verification

- Audit consumers before deleting shared APIs, types, styles, translations, or dependencies. Protect
  attachments, inline media, file references, and directory selection.
- Simplifying the transcript must not delete raw session content, agent context, full history, or
  export data.
- Preserve path checks, origin checks, credential isolation, and session shutdown. Simpler UI is not
  permission to weaken security.
- Partial output is not successful execution. Explicit user expansion choices override defaults for
  retained cards.
- Use semantic theme variables and support keyboards, visible focus, narrow screens, and reduced
  motion.
- The browser target is Chromium-based only (`browserslist` is `chrome >= 130`); modern client
  syntax such as regular-expression lookbehind is acceptable.
- Run relevant checks and add regression coverage where appropriate. Report actual results and
  unverified areas; existing tests are not evidence that they passed.
- Preserve the owner's unrelated changes. Do not perform unrequested data migrations or destructive
  data cleanup.

## Attribution

Source project: [agegr/pi-web](https://github.com/agegr/pi-web). Agent:
[Pi](https://github.com/earendil-works/pi). Preserve the copyright and license notice in `LICENSE`;
source-project maintenance conventions and document structure are not requirements.
