# Pi Web

A minimal GUI for Pi: talk to the agent, follow its work, and continue the conversation in a clear,
polished browser interface.

This is an independently maintained project for personal, local use. It no longer tracks or merges
its source project. It is not an IDE or an all-in-one manager.

## Scope

- Choose a working directory and create or resume sessions.
- Send messages, attachments, and file references.
- Read streaming replies and inspect tool execution, results, and errors.
- Discuss a change in Plan, a read-only mode where the agent asks you questions before anything is
  written.
- Access the controls and information needed for the conversation.

Pi provides the agent capabilities; this project provides their presentation and interaction.
Visualizing the CLI does not mean building a management panel for every CLI feature.

File browsing, file previews, Git/worktree management, terminal tabs, and the demo have been removed
from the interface. Historical settings and management modules still exist in the code; their
presence is not a commitment to retain them.

## Run locally

Use the latest Node.js LTS release and the latest Bun release.

```sh
bun install --frozen-lockfile
bun run dev
```

Open <http://127.0.0.1:30141>. The app uses local Pi configuration and credentials. Sessions default
to `~/.pi/agent/sessions/`. Existing sessions can be browsed without model credentials; sending
prompts requires a configured provider.

Bun manages dependencies and invokes scripts. Node.js remains the runtime.

```sh
bun run test
bun run typecheck
bun run lint
```

Use `bun run test`, not `bun test`. See [local packaging](packaging/README.md) for portable builds.
There is no maintained CI, npm publication workflow, or automated update commitment.

## Security

This interface controls an agent that can read and write files and execute commands. It is not a
read-only website. Keep the default loopback binding; prefer SSH forwarding for remote access:

```sh
ssh -N -L 30141:127.0.0.1:30141 user@server
```

Do not expose it directly to the internet. Network access requires appropriate access controls and
encrypted transport. `PI_WEB_PASSWORD` enables login but does not encrypt traffic. Back up Pi data
before deleting sessions or changing configuration.

## Documentation

- [Project direction and documentation index](docs/README.md)
- [Interface principles](docs/design.md)
- [Architecture](docs/architecture.md)
- [Coding agent instructions](AGENTS.md)
- [Local browser tests](e2e/README.md)

All project documentation is maintained in English.

## Attribution and license

Based on [agegr/pi-web](https://github.com/agegr/pi-web), with agent capabilities provided by
[Pi](https://github.com/earendil-works/pi). Thanks to the original authors and contributors.

This independent personal version does not represent the source project. The [MIT license](LICENSE)
and original copyright notice are retained. Source-project release checks and updater commands have
been removed.
