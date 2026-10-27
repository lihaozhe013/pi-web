# Architecture

This is a map of the current implementation, not a requirement to preserve its structure. Consult
code and installed SDK types before changing behavior.

## Runtime

Next.js serves the browser UI and local HTTP APIs. React renders the conversation. Node.js hosts Pi
sessions in process; Bun manages dependencies and script invocation.

## Main entry points

| Area                     | Entry points                                                |
| ------------------------ | ----------------------------------------------------------- |
| Layout and navigation    | `components/AppShell.tsx`                                   |
| Session list             | `components/SessionSidebar.tsx`                             |
| Conversation and input   | `components/ChatWindow.tsx`, `components/ChatInput.tsx`     |
| Transcript rendering     | `components/MessageView.tsx`, `components/MarkdownBody.tsx` |
| Client session lifecycle | `hooks/useAgentSession.ts`                                  |
| Agent runtime            | `lib/rpc-manager.ts`                                        |
| Saved session reading    | `lib/session-reader.ts`                                     |
| Shared types             | `lib/types.ts`, `lib/pi-types.ts`                           |
| HTTP APIs                | `app/api/`                                                  |
| Local launcher           | `bin/pi-web.js`                                             |
| Portable packaging       | `packaging/`                                                |

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

## Session flow

1. Session APIs enumerate and read saved Pi sessions. Browsing does not itself require starting an
   agent.
2. Sending a prompt starts or reuses an in-process session through the agent API and runtime
   manager.
3. Agent events stream to the browser over SSE. Client state reconciles live events with saved
   history.
4. The transcript renders replies, tool activity, and errors. Display filtering is separate from
   persisted history and model context.

## Session output speed

Pi Web observes the first nonempty assistant stream delta and response end with a monotonic clock.
For successful responses with output usage and at least 500 ms of observed streaming, a Pi custom
entry immediately before the assistant message records output tokens and stream duration. It is not
model context. Full-file statistics count only records paired with their assistant message; live
messages carry the same measurement separately for immediate display. Older history cannot recover
first-token timing. The end-to-end speed continues to use Pi's recorded response durations.

## Modes and questions

`lib/tool-presets.ts` selects the coding tools a session may call. Plan is the one preset that also
carries a work mode, because it pins the same read-only tools as Read-only; the mode is stored in
the session log (`lib/work-mode.ts`, `pi-web:work-mode`) and travels next to the tool list in
`GET /api/sessions/[id]` and `get_tools`.

Users combine the built-in coding tools into named custom presets beside the built-in ones. The
list lives in `pi-web-tool-presets.json` in the agent directory (`lib/custom-tool-presets.ts`), is
served whole by `GET/PUT /api/tools/presets`, and stores canonical tool names (`bash` stands for
whatever shell the PowerShell setting selects). Settings › Tools edits the list
(`components/ToolPresetsSettings.tsx`), and a save bumps a refresh key so the session's composer
reloads its copy. A pick is stored and pinned like any preset: the UI carries it as `custom:<id>`
and resolves it against the list (`getToolNamesForSelection`), while the session itself keeps
pinning plain tool names, so a deleted preset simply releases the sessions that still prefer it
back to the configured defaults.

`lib/plan-mode-extension.ts` reads that entry on every prompt and tool call:

- The prompt gains the plan guidelines, so the model discusses and asks before proposing changes.
- Write, shell, patch, and subagent tools are refused in `tool_call`. The tool selection alone is
  not enough: a carried extension tool is outside the pinned list. MCP writes stay governed by the
  existing `readOnlyHint` policy, and other installed extension tools keep their own semantics.
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

## Math rendering dependencies

Markdown and the chat minimap use `rehype-katex` with the KaTeX stylesheet imported by
`app/layout.tsx`. A scoped Bun override keeps the plugin's renderer on the same KaTeX version as
the stylesheet, despite its older declared range. Review this override when upgrading the plugin;
Mermaid and micromark retain their own KaTeX dependency versions. The scoped override requires a
Bun version that supports lockfile version 3.

## Boundaries to preserve

- Streaming updates, completed results, cancellation, and reconnects are distinct states.
- Session identifiers and message keys must remain stable when switching between live and saved
  data.
- Session forking and in-session branch navigation are different operations.
- Closing a runtime must release resources and allow extensions to shut down.
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
serve attachments and references; Git identity and worktree fallback affect session grouping and
directory selection; and transcript filtering must not remove reasoning from history or exports.
Check saved sessions, drafts, streaming, keyboard and narrow-screen behavior, and legacy browser
preferences as relevant to each change.
