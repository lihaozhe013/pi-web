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

## Session flow

1. Session APIs enumerate and read saved Pi sessions. Browsing does not itself require starting an
   agent.
2. Sending a prompt starts or reuses an in-process session through the agent API and runtime
   manager.
3. Agent events stream to the browser over SSE. Client state reconciles live events with saved
   history.
4. The transcript renders replies, tool activity, and errors. Display filtering is separate from
   persisted history and model context.

## Modes and questions

`lib/tool-presets.ts` selects the coding tools a session may call. Plan is the one preset that also
carries a work mode, because it pins the same read-only tools as Read-only; the mode is stored in
the session log (`lib/work-mode.ts`, `pi-web:work-mode`) and travels next to the tool list in
`GET /api/sessions/[id]` and `get_tools`.

`lib/plan-mode-extension.ts` reads that entry on every prompt and tool call:

- The prompt gains the plan guidelines, so the model discusses and asks before proposing changes.
- Write, shell, patch, and subagent tools are refused in `tool_call`. The tool selection alone is
  not enough: a carried extension tool is outside the pinned list. MCP writes stay governed by the
  existing `readOnlyHint` policy, and other installed extension tools keep their own semantics.
- Leaving the mode needs no rebuild; the next message simply runs without the guidelines.

`lib/ask-user-extension.ts` registers `ask_user` in every normal (non-Chat-only) session. The model
asks one focused question with optional options; the browser shows it through the same extension UI
dialogs every other extension uses, and the answer returns as the tool result. A dismissed dialog is
reported as no answer, never as agreement.

Pi sessions normally live under `~/.pi/agent/sessions/`. The app also maintains UI state such as
session pins and archive choices. Avoid unnecessary changes to Pi's data format or duplicate agent
configuration.

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

Historical configuration surfaces and retired workspace helpers remain. They are implementation
debt, not product commitments. Remove them after auditing consumers and preserving the conversation
workflow. See [cleanup](cleanup.md).
