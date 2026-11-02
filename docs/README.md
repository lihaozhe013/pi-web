# Project Direction

## A minimal GUI for Pi

Pie centers on one workflow: choose a directory, send Pi a message, watch it work, and continue the
conversation.

Pi supplies the agent capabilities. This project improves the visibility and usability of the CLI
workflow, without replacing Pi or creating a parallel configuration, extension, or execution system.
Visualizing the CLI does not require a graphical manager for every command or setting.

Minimal describes the result, not the goal. The goal is reviewable signal: show what lets the user
review the agent's work and judge whether it is on track, and hide what does not serve that — long
exploratory output, raw dumps, and other detail that cannot be read at a glance. A quiet interface
is worth having only because it leaves that signal visible.

Priorities: smooth conversation, clear execution feedback, a quiet and polished interface, then
feature count.

## Scope

Keep sessions, message input, streaming responses, tool feedback, and the controls needed to use
them. Directory selection, attachments, inline media, and file references serve the conversation;
they are not a file manager.

Do not build an IDE, file workspace, Git/worktree manager, embedded terminal, multi-panel dashboard,
or comprehensive configuration center. Pie does not implement or manage subagents; installed Pi
extensions remain Pi's responsibility. Prefer a good default over speculative settings.

The one exception is a single serial task queue, described in [Tasks](tasks.md): one active task at
a time, each executed by a fresh Pi CLI child process over Pi's own RPC protocol. It adds no second
agent protocol and no parallelism, and the chat experience must keep working without it. The queue
also has one management surface, described in [Task manager](task-manager.md): an ordinary chat
session in its own project whose tools read and change the queue. Those tools control the queue, not
agents; they add no subagent runtime and no second way to start work.

Historical management pages, settings, and project-specific style layers remain in the code. They
are not product commitments. Review them individually and leave configuration to Pi or its CLI when
a separate panel adds little value.

## Maintenance

Maintain this project independently, without upstream merges. Change the stack and structure freely
when doing so reduces complexity. There is no permanent separation between inherited code and fork
enhancements.

Development, verification, and optional portable packaging are local. No CI, public release
pipeline, or automated update commitment is maintained.

## Documentation

All project documentation is maintained in English, without translated copies.

| Document                            | Purpose                               |
| ----------------------------------- | ------------------------------------- |
| [README](../README.md)              | Usage, security, and attribution      |
| [Agent instructions](../AGENTS.md)  | Rules for coding assistants           |
| [Interface principles](design.md)   | Presentation and interaction          |
| [Architecture](architecture.md)     | Current entry points and boundaries   |
| [Desktop shell](desktop.md)         | Tauri 2 window and desktop packaging  |
| [Tasks](tasks.md)                   | Serial task queue, execution boundary |
| [Task manager](task-manager.md)     | Agent-driven queue control            |
| [Packaging](../packaging/README.md) | Local portable builds                 |
| [Browser tests](../e2e/README.md)   | Local browser regression testing      |

These documents replace the upstream snapshot, fork-specific design guide, translated guides,
historical ADRs, and release instructions. Use Git history for historical context rather than
maintaining conflicting rule sets. Preserve third-party attribution and license notices.

## Attribution

Based on [Pi Web](https://github.com/agegr/pi-web) by agegr, using
[Pi](https://github.com/earendil-works/pi). Retain the original attribution and MIT license;
attribution does not require adopting the source project's maintenance model.
