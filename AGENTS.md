# Pi Web — Agent Instructions

Pi Web is a personal, local GUI for Pi. Keep changes focused on making conversations and agent
activity clear and convenient. Pi owns agent capabilities; use the installed SDK rather than
creating a parallel protocol.

## Changes

- Read [project direction](docs/README.md) and [interface principles](docs/design.md) for product
  or UI work. Read [architecture](docs/architecture.md) for runtime and API changes.
- Prefer simple solutions. Check consumers before removing shared behavior.
- Preserve user data, session history, conversation inputs, and security checks. Keep path and origin
  validation, credential isolation, and session shutdown intact.
- For UI changes, support keyboard use, visible focus, narrow screens, and reduced motion; use
  semantic theme variables.
- Write project documentation in English and update relevant docs with code changes.

## Development

- Bun manages dependencies and scripts; Node.js runs the app. Keep explicit `node` invocations.
- Install with `bun install --frozen-lockfile`. Use `bun run dev`, `bun run typecheck`, and
  `bun run lint` as relevant.
- For each feature or bug fix, run only its single most relevant test file (for example,
  `node --test path/to/test.mjs`); do not run the full test suite. The owner runs the full suite
  periodically. For packaging changes, use `bun run test:portable`.
- Reuse a healthy development server. Do not start a second server in the same checkout or run a
  production build in an active development checkout; portable builds run in isolation.
- Report which checks ran and what remains unverified.

## Commits

- Use Conventional Commits: `<type>[optional scope]: <description>` (for example, `feat: add X`
  or `fix(api): handle Y`).
