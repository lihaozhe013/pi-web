# Personal fork: conversation workspace design

`main` is an independent, local-only UI for talking to the pi agent and watching
it work. Upstream is reference material. No CI or release pipeline is maintained.

## Layout and retained behavior

- The left sidebar manages sessions and project groups: search, new conversation,
  rename, pin, archive, restore, delete, and Fork.
- The center holds conversation history, streaming replies, thinking, tool calls,
  tool output, and the composer. Attachments and file mentions remain available.
- A new conversation can choose a project or directory, including the default
  dated directory. A pre-existing worktree is usable as an ordinary directory.
- Toolbar buttons open one information sidebar: agents, conversation branches,
  system prompt, tool definitions, or session information and usage statistics.
- The information sidebar is 400px wide. It overlays when the remaining chat
  width would be below 420px and fills phone widths. It has a close button,
  Escape dismissal, and focus restoration; modal overlays contain keyboard focus.
- Chat navigation is a right-edge rail of short horizontal lines. Hover or
  activation opens a compact directory of turn prompts and answer headings;
  selecting an entry jumps to it. It overlays the conversation without reserving
  a column, and replaces the old dot rail, lock toggle, and full-height preview.
- Selecting a subagent opens its conversation in the center, using the same
  session navigation as the sidebar.

File trees, file previews, Git controls, worktree operations, terminal tabs,
file workspace persistence, and the static demo are removed. Agent tools still
read/write files and execute commands, including Git. Shared file access stays
available for chat attachments and inline media with its existing access checks.

## Visual and tool-output principles

Retain the quiet surfaces, soft corners, existing themes, readable 16px chat
baseline, and visible keyboard focus. Use semantic theme variables rather than
fixed colors. Keep the chat and sidebar visually connected.

Process details start open for retained steps. Shell cards open while executing
and disappear after success, including user-run commands. Failed commands retain
a folded error summary. Write/edit/patch cards open while executing and fold
after completion. Explicit choices control retained cards. Long shell
results show their last 16 lines with Show all/less when expanded.

Thinking and explicit read tools leave no cards or counted groups in the main
transcript. A transient status shows Thinking or Reading with the current file
while that work runs, then disappears. Successful shell commands also leave no historical card. Full content remains
available through the existing full-history toolbar action; storage, exports and agent context
are unchanged. Provider errors, truncation notices and transcript notices remain
visible. The old default-expanded thinking setting is removed from the chat UI.

Code highlighting is an optional, lazy enhancement. Streaming input and unknown
languages remain readable without it. Tool cards carry no outline: the surface
tint alone draws them, state stays in the header's status mark, inner dividers
are the border token at less than half strength, and errors warm the tint
instead of drawing a red frame. Animation respects reduced motion.

## Implementation and follow-up

`AppShell` coordinates the retained layout; `SessionSidebar` owns session/project
management; `ProjectPicker` selects a directory for a fresh composer;
`SessionInfoSidebar` hosts the toolbar information surfaces. Existing chat and
tool-card components continue to own transcript rendering.

See [cleanup tasks and manual acceptance](ui-cleanup-todo.md) for deferred code,
style, translation, and shared API cleanup. Packaging remains local through
Bun 1.4.4 and Node.js; see [portable packaging](../packaging/README.md).

The desktop conversation directory remains visible whenever the conversation has
turns, even if the transcript fits without scrolling. Collapsing activity or
resizing the chat must not remove its entry point.
