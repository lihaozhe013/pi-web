# Development Guide

This is a personally maintained, minimal Pi GUI, not a public distribution effort or an upstream-tracking branch.

## Before changing anything

Read [project direction](docs/README.md) and [interface principles](docs/design.md). Ask whether the change makes talking to the agent or following its work more direct, and whether less UI and code could achieve it.

Rewrite, rename, merge, or delete modules as needed. Do not preserve a separate fork patch layer or expand the app into an IDE, project dashboard, or plugin marketplace. Existing management features must justify their place too.

All project documentation must be in English. Maintain one canonical set rather than translated copies.

## Environment and commands

Use Node.js >=22.19.0 and Bun 1.4.4:

```sh
bun install --frozen-lockfile
bun run dev
bun run test
bun run typecheck
bun run lint
bun run test:portable
```

Node.js runs the app and tests. Change dependencies through `bun add` / `bun remove`, commit `bun.lock`, and pin Pi packages to exact versions.

Development listens on `127.0.0.1:30141`. Reuse a healthy server; do not run two dev servers in one checkout or build production output in an active development directory. See [packaging](packaging/README.md) for isolated builds.

## Completion criteria

- Keep changes focused, typed, and free of speculative abstractions.
- Audit API consumers, types, styles, translations, dependencies, and tests when removing a feature.
- Protect sessions and configuration; hidden transcript content is not disposable data.
- Check narrow layouts, keyboard interaction, focus, themes, and reduced motion for UI changes.
- Check errors, cancellation, reconnection, and security boundaries for execution and file-access changes.
- Update relevant docs and report which checks ran and which remain unverified.

There is no CI, automated release, or public distribution requirement. Run [browser tests](e2e/README.md) locally as needed. See [AGENTS.md](AGENTS.md) for detailed coding constraints.
