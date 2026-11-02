# Architecture

This is a map of the current implementation, not a requirement to preserve its structure. Consult
code and installed SDK types before changing behavior.

## Runtime

Next.js serves the browser UI and local HTTP APIs. React renders the conversation. Node.js hosts Pi
sessions in process; Bun manages dependencies and script invocation.

## Main entry points

| Area                     | Entry points                                                       |
| ------------------------ | ------------------------------------------------------------------ |
| Layout and navigation    | `components/AppShell.tsx`                                          |
| Session list             | `components/SessionSidebar.tsx`                                    |
| Conversation and input   | `components/ChatWindow.tsx`, `components/ChatInput.tsx`            |
| Composer hub             | `components/ComposerHub.tsx`, `components/GoalToggle.tsx`          |
| Transcript rendering     | `components/MessageView.tsx`, `components/MarkdownBody.tsx`        |
| Run history              | `components/ExecutionHistoryPanel.tsx`, `lib/execution-history.ts` |
| Turn copy                | `lib/turn-copy.ts`, `components/TurnCopy.tsx`                      |
| Client session lifecycle | `hooks/useAgentSession.ts`                                         |
| Agent runtime            | `lib/rpc-manager.ts`                                               |
| Saved session reading    | `lib/session-reader.ts`                                            |
| Shared types             | `lib/types.ts`, `lib/pi-types.ts`                                  |
| Task queue               | `lib/tasks/`, `app/api/tasks/`, `components/TaskWorkspace.tsx`     |
| HTTP APIs                | `app/api/`                                                         |
| Local launcher           | `bin/pie.js`                                                       |
| Portable packaging       | `packaging/`                                                       |
| Desktop shell            | `src-tauri/`, `packaging/desktop.mjs`                              |

`AppShell` owns the page frame for both views: the session sidebar, the toolbar with the
`Chat | Tasks` switch, the center column, and one resizable right-hand panel. The center renders the
conversation or the task work surface from `components/TaskWorkspace.tsx`; the right panel renders
Runs in chat and the task Queue in `?mode=tasks`. The sidebar and toolbar are not rebuilt, so the
task view keeps the session list and the Settings entry in place. `TaskWorkspace` owns the queue
state and portals its list into the right panel, which keeps that panel full height beside the
center instead of nesting it in the work surface.

## Browser appearance and settings

`components/SettingsPanel.tsx` owns modal navigation and result focus; `AppearanceSettings.tsx` owns
the appearance editor. `lib/settings-search.ts` is a metadata-only index with stable control IDs,
translated labels and availability hints. Searches do not read persisted configuration content.

Settings › Global AGENTS.md edits Pi's user-level context file from `getAgentDir()` as plain text.
`components/GlobalAgentsConfig.tsx` reads and saves it through `app/api/global-agents`;
`lib/global-agents-file.ts` keeps the path fixed, bounds the file at 1 MiB, and replaces it
atomically. There is no Markdown preview or general file access on that route.

`hooks/useFontPreferences.ts` restores UI/monospace families, weights and independent sizes,
publishes CSS variables, persists browser preferences and synchronizes font changes between tabs.
Existing family/weight keys and the chat text/width keys in `hooks/useChatAppearance.ts` are
retained; no migration rewrites saved preferences. Font size changes notify the same consumers as
font family changes. The session virtualizer includes UI-size growth in its row offsets.

## Model settings context

Model APIs use global Pi settings and global extensions when no working directory is selected. An
explicit working directory retains path authorization, project trust, and project settings
semantics. Global and project model lists have separate cache keys; default and reasoning edits
still write global settings and refuse edits shadowed by the selected project's settings.

Settings › Models › General saves a global context window limit in `pie-model-settings.json` in the
agent directory (`lib/model-context-limit.ts`, served by `app/api/models/context-limit`). Because pi
compacts from the session model's native `contextWindow`, the limit is applied where models are
resolved: `withContextWindowLimit()` wraps the `ModelRuntime` the same transparent way
`withDeferredProviderModels()` does — session runtimes in `lib/rpc-manager.ts`, the shared
extension-loaded runtime in `lib/model-runtime.ts`, and the listing routes. Every model then
resolves with `min(native, limit)` as its window, so compaction triggers earlier and prompts stay
smaller. A smaller native window keeps itself, and an explicit per-model `contextWindow` in
`models.json` replaces the default entirely. The limit is re-read per resolution, so a save applies
to new resolutions without rebuilding a runtime; open sessions keep their model object until the
model is selected again. Pi CLI sharing the agent directory does not apply the cap.

## Product boundary

Pie hosts ordinary Pi SDK sessions. It does not register subagent control tools, maintain agent
profiles, or create Git worktrees. There are no subagent HTTP routes or specialized transcript
viewers. Installed extensions follow Pi's normal loading semantics and render through generic tool
and extension UI paths.

One scheduled surface exists: the serial task queue in [Tasks](tasks.md). It never runs two tasks at
once, never reuses a session between tasks, and speaks only Pi's RPC records to a Pi CLI child
process. It imports nothing from `lib/rpc-manager.ts`, so deleting `lib/tasks`, `app/api/tasks`, and
the task workspace leaves chat behavior unchanged. A task's session is an ordinary Pi session and
renders through the normal transcript; while its process runs, that session is read-only in chat so
two writers never share one session file.

## Serial task queue

The queue stores tasks in SQLite (`<agentDir>/pie-tasks.db`, `node:sqlite`, WAL) and claims one
`PENDING` row per transaction, asserting that no other row is `IN_PROGRESS`. Each attempt starts a
new `pi --mode rpc` child in the task's working directory with a new session id; the loop waits for
`agent_settled`, runs the configured verification commands, and settles the task. Standing
instructions from the queue defaults are appended to every task prompt, so rules such as committing
when the work is done are soft constraints the agent follows rather than queue code. `FAILED` and
`BLOCKED` both pause the loop until a person resumes it, and a restart settles any row left
`IN_PROGRESS` as `BLOCKED`.

Run controls travel as RPC commands (`abort`), and `ask_user` reaches the browser through Pi's
extension UI sub-protocol, so the tool keeps one implementation for both the in-process chat session
and a task child. The queue owns no model behavior: prompts, tools, models, and extensions are Pi's,
resolved from the same agent directory chat uses.

Configuration, the queue lock, and the only chat-side contact point stay small:
`<agentDir>/pie-task-orchestrator.json` holds the queue defaults and is re-read per run,
`<agentDir>/pie-tasks.lock` is the `proper-lockfile` lock that keeps one process driving the queue,
and `lib/tasks/active-sessions.ts` is an in-memory set of session ids. `GET /api/agent/running` and
`GET /api/sessions` include those ids so the composer in chat mode can disable itself, and the agent
route refuses a prompt for a session in the set. `lib/tasks/config.ts` owns the defaults,
`lib/tasks/prompt.ts` the task prompt and standing instructions, `lib/tasks/gate.ts` the
verification commands, and `lib/tasks/request.ts` the route validation and error mapping.
`instrumentation-node.ts` uses the same shutdown signal to abort the active child and settle its
task.

Session catalog entries are grouped by their recorded working directory. Directory validation and
model lookup do not inspect Git or infer a replacement directory for a missing checkout. A missing
directory is an error. Pins, archive status, search, and running indicators apply to individual
sessions, not session families. Deletion shuts down only the requested sessions and preserves
ordinary forks, reparenting their display metadata when necessary.

Old Pi Web subagent metadata, resource snapshots, profiles, and settings have no compatibility or
migration layer. Cleanup removes code, not user files.

## Session flow

1. Session APIs enumerate and read saved Pi sessions. Browsing does not itself require starting an
   agent.
2. Sending a prompt starts or reuses an in-process session through the agent API and runtime
   manager.
3. Agent events stream to the browser over SSE. Client state reconciles live events with saved
   history.
4. The transcript renders replies, tool activity, and errors. Display filtering is separate from
   persisted history and model context. In the default display every tool call except a write, an
   edit, or a patch is filtered out of the transcript and collected by the Runs panel from the
   loaded messages plus live execution state; `hooks/useRetainedExecutionHistory.ts` keeps a
   finished call in place while its stored result arrives. Settings › General can set the transcript
   to conversation only (`hooks/useTranscriptMode.ts`, a browser preference):
   `lib/quiet-activity.ts` then filters out every call, and `lib/execution-history.ts` collects the
   kept cards too, carrying the diff a card would have shown (`diffFiles`) instead of the arguments
   that hold a whole file. `AppShell` treats the panel as part of the default docked page: it is
   open unless the user collapsed it, closed where it would overlay the conversation until the user
   asks for it, and hidden by Settings without being collapsed. `components/SessionInfoSidebar.tsx`
   skips focus for a panel the user did not ask for. A hidden `lib/write-diff-extension.ts`
   snapshots a write target before execution and attaches a unified patch to the result, so a
   write's card, in the transcript or in the Runs panel, shows the change instead of the whole file;
   `apply_patch` already carries its own patch. The turn's own record of what it wrote is one
   counted line under its answer (`components/TurnWrittenFiles.tsx`); the names and diffs belong to
   the panel.

## Session output speed

Pie observes the first nonempty assistant stream delta and response end with a monotonic clock. For
successful responses with output usage and at least 500 ms of observed streaming, a Pi custom entry
immediately before the assistant message records output tokens and stream duration. It is not model
context. Full-file statistics count only records paired with their assistant message; live messages
carry the same measurement separately for immediate display. Older history cannot recover
first-token timing. The end-to-end speed continues to use Pi's recorded response durations.

## Modes and questions

`lib/tool-presets.ts` selects the coding tools a session may call. Plan is the one preset that also
carries a work mode, because it pins the same read-only tools as Read-only; the mode is stored in
the session log (`lib/work-mode.ts`, `pie:work-mode`) and travels next to the tool list in
`GET /api/sessions/[id]` and `get_tools`.

Users combine the built-in coding tools into named custom presets beside the built-in ones. The list
lives in `pie-tool-presets.json` in the agent directory (`lib/custom-tool-presets.ts`), is served
whole by `GET/PUT /api/tools/presets`, and stores canonical tool names (`bash` stands for whatever
shell the PowerShell setting selects). Settings › Tools edits the list
(`components/ToolPresetsSettings.tsx`), and a save bumps a refresh key so the session's composer
reloads its copy. A pick is stored and pinned like any preset: the UI carries it as `custom:<id>`
and resolves it against the list (`getToolNamesForSelection`), while the session itself keeps
pinning plain tool names, so a deleted preset simply releases the sessions that still prefer it back
to the configured defaults.

`lib/plan-mode-extension.ts` reads that entry on every prompt and tool call:

- The prompt gains the plan guidelines, so the model discusses and asks before proposing changes.
- Write, shell, and patch tools are refused in `tool_call`. The tool selection alone is not enough:
  a carried extension tool is outside the pinned list. MCP writes stay governed by the existing
  `readOnlyHint` policy, and other installed extension tools keep their own semantics.
- Leaving the mode needs no rebuild; the next message simply runs without the guidelines.

`lib/ask-user-extension.ts` registers `ask_user` in every normal (non-Chat-only) session. The model
asks one focused question with optional options. `lib/ask-user-presentation.ts` scopes presentation
metadata to its standard Pi select/input calls using AsyncLocalStorage, shared across extension
loader module instances. The runtime adds that metadata to the existing extension UI request;
`components/AskUserPanel.tsx` renders only these tagged requests above the composer. Options and
free-form text return through the existing response channel, without a second text dialog in the web
UI. Other Pi UI hosts keep the select/input fallback. Reconnect replay preserves the tag; abort and
session shutdown retain the existing request cleanup. Skipping is reported as no answer, never as
agreement. Failed browser submissions retain the panel for retry.

Pi sessions normally live under `~/.pi/agent/sessions/`. The app also maintains UI state such as
session pins and archive choices. Avoid unnecessary changes to Pi's data format or duplicate agent
configuration.

## Autonomous goals

Pie does not implement autonomous goals. A Pi package owns the loop, the budget, the completion
report and its own pause rules: `pi-better-goal` and `pi-codex-goal` are both understood, and the
same dialog drives either one.

`pi-better-goal` is a dependency of Pie itself, so goals work on a fresh install with no second
setup step. `lib/goal-package.ts` resolves that copy and hands its package root to the session's
resource loader as an extension path — the same path a person's own package takes, so the package's
`pi.extensions` manifest and its peer modules decide how it loads, and no import of its TypeScript
enters the Next build. A goal package the person configured themselves (global or project settings)
wins over the bundled one: two of them in one session would run two loops over one goal. Removing
the package from the app's dependencies, or configuring another goal package, leaves the sessions
with the package the person chose; a session with none offers no goal card.

`lib/goal-driver.ts` is the whole contract. It reads one status word from the package's session
entries — `customType` `pi-better-goal` or `pi-codex-goal`, `kind` `set` or `clear`,
`data.goal.status` — and turns it into three phases: running, waiting or done. Anything else the
package writes, such as `continuation-state` or permission records, is skipped. Five commands go the
other way: `/goal <objective>`, `/goal pause`, `/goal resume`, `/goal complete` and `/goal clear`;
the objective of a start is what the dialog holds, or, when it was not given one, the last message
the person wrote, read from the branch by `lastUserObjective()`.

The goal dialog sends `{ type: 'goal', action, objective? }` and `lib/rpc-manager.ts` forwards it as
that command, so the browser never composes a command itself and never decides anything about the
goal. The wrapper reads the branch and publishes `{ available, goal? }` as the `pie-goal` extension
status on three occasions: once extensions are bound, on every `entry_appended` that carries a goal
record, and after a command. The same status is in `get_state`, so a reload costs no extra route,
and `GET /api/sessions/[id]` reads the same record for a session with no live runtime. The package's
own status and widget are filtered out of the status bar, because the dialog already says where the
goal stands.

A goal an earlier process left `active` is paused when its session is opened again: the wrapper
sends the package's own `/goal pause` after binding, so reopening a session cannot resume an
unattended run (and its cost) on its own. Stop pauses it the same way, through the package's abort
handling. Every other rule — what counts as done, how tokens are counted, when a continuation is
retried — belongs to the package; a status word this code does not know is shown as waiting instead
of guessed. The browser does not run the loop, and closing it does not stop the server. Do not use
this feature with untrusted workspaces or permissions you would not grant to an unattended agent.

## Math rendering dependencies

Markdown and the chat minimap use `rehype-katex` with the KaTeX stylesheet imported by
`app/layout.tsx`. A scoped Bun override keeps the plugin's renderer on the same KaTeX version as the
stylesheet, despite its older declared range. Review this override when upgrading the plugin;
Mermaid and micromark retain their own KaTeX dependency versions. The scoped override requires a Bun
version that supports lockfile version 3.

## Boundaries to preserve

- Streaming updates, completed results, cancellation, and reconnects are distinct states.
- Session identifiers and message keys must remain stable when switching between live and saved
  data.
- Session forking and in-session branch navigation are different operations.
- Closing a runtime must release resources and allow extensions to shut down.
- The task queue keeps its claim atomic, its single-child rule, and its independence from the chat
  runtime; a task's session is never reused for a second attempt.
- Shared file APIs still support attachments, inline media, uploads, and references. A removed file
  browser does not make every file helper unused.
- Path authorization, origin validation, and credential handling remain security boundaries.
- Pi extension behavior should follow Pi semantics rather than a web-specific parallel API.

## Transitional structure

Historical configuration surfaces and retired workspace helpers remain implementation debt, not
product commitments. Review management panels individually, preferring Pi configuration where a
separate panel adds little value. Preserve the underlying agent capabilities and essential
conversation controls.

Before removing obsolete code, audit consumers and tests. In particular, shared file APIs still
serve attachments and references; session grouping uses the recorded working directory rather than
Git repository identity; and transcript filtering must not remove reasoning from history or exports.
Check saved sessions, drafts, streaming, keyboard and narrow-screen behavior, and legacy browser
preferences as relevant to each change.
