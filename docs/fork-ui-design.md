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

Process details start open. Shell cards open when execution starts and retain
command/output visibility after success or failure. Long shell results initially
show the last 16 lines with Show all/less. Write/edit/patch cards open only after
successful completion; reads/searches stay folded. Explicit user folds take
precedence, and thinking retains its separate preference.

Consecutive reads and thinking blocks collapse into one counted activity row
when there are two or more, including across adjacent assistant messages.
Replies, commands, file mutations and custom messages end a group. A single
thinking block retains its preference; grouped thinking starts folded. Collapsed
thinking shows only the label "Thought" and its duration, without a content
preview. Search hits and failed reads reveal their group. Entry anchors stay mounted for history
navigation, and deferred thinking still loads only when its own block is opened.
Explicit tool folds take precedence over presentation defaults.

Code highlighting is an optional, lazy enhancement. Streaming input and unknown
languages remain readable without it. Tool frames stay neutral, errors remain
clear, and animation respects reduced motion.

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
