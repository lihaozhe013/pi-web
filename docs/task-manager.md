# Task Manager: an agent that drives the queue

**Status: implemented.** This document specifies a management surface for the per-project task
queues described in [Tasks](tasks.md). The sections below describe the built behavior; the
implementation status table records what exists.

## What it is

The queue can already be operated by a person from `?mode=tasks`. This design adds a second
operator: an ordinary chat session, living in its own project, that holds the full coding toolset
plus a complete set of queue tools, and that receives the queue's status changes as messages. The
user talks to it in chat exactly as they talk to any other session; it queues, edits, reorders,
starts and stops tasks, and reports what happened.

It is not a new runtime. It is one Pi extension loaded into one working directory, ten tools over
the existing queue controller, and a durable event log the extension reads. No subagents, no
parallel execution inside a project, no second protocol, no separate daemon.

## Boundary

`docs/README.md` and `docs/architecture.md` previously refused "subagent control tools". This design
narrows that refusal the same way [Tasks](tasks.md) already narrowed it for the queue:

- **Allowed:** one ordinary chat session in one dedicated project, whose tools read and change the
  per-project queues through `lib/tasks/queue.ts` and `lib/tasks/orchestrator.ts`.
- **Allowed:** starting, pausing, or inspecting different projects independently; the manager names
  a project by its working directory.
- **Still refused:** subagent spawning or control, parallel execution inside a project, agent
  profiles, worktrees, a second agent protocol, raw SQL access to the queue database, and the tools
  appearing in any other project or in a tool preset.

The tools control the queues, not agents. The project queues stay the only schedulers, and every
rule they enforce today (one `IN_PROGRESS` row per project, fencing tokens, an immutable running
task, `cwd` authorization) applies to the agent exactly as it applies to the board.

## Why a project, not a mode

In Pie a project _is_ a working directory: `SessionInfo.projectRoot` and `projectKey` come from the
session's `cwd`, and the sidebar groups by it. A "virtual project" would need a second notion of
identity in the session list, the composer, `project-trust`, model scoping and file access. A real
directory needs none of that and gives three things for free: a stable group in the sidebar, a place
for the orchestrator's standing instructions (`AGENTS.md`), and an exact predicate for tool
injection.

### The directory

```
<agentDir>/task-manager/          created on first open, never inside a user repository
  AGENTS.md                       written once by Pie, then the user's to edit
```

- `<agentDir>` is `getAgentDir()`, beside `sessions/`, `pie-tasks.db` and the queue's other files.
- Pi loads context files from the agent directory, the cwd and its ancestors, deduplicated by real
  path (`loadProjectContextFiles`), so placing the project under the agent directory does not read
  the global `AGENTS.md` twice.
- `AGENTS.md` is created only when absent, with the smallest useful content: what this project is,
  what the queue guarantees, and the working rules below. It is never overwritten or migrated. It is
  where a person changes the orchestrator's habits (report every settle, do not delete without being
  asked, prefer small verifiable tasks, and so on).
- `lib/session-ui-state-shared.ts`'s `projectNames` gets a one-time alias, "Task Manager", so the
  sidebar reads as a name rather than a folder. No new persistence is introduced for it.
- The directory must exist before a session can start. `POST /api/tasks/manager` creates it and the
  default `AGENTS.md` and returns `{ cwd, projectKey }`; the client then starts a session through
  the existing `POST /api/agent/new` with `ensure_session`.

A session outside this directory is untouched: the extension is not loaded, the tools are not
registered, and `getAllTools()` never lists them.

## Tool injection

`lib/rpc-manager.ts`'s `startRpcSession` is the only place that knows the effective session `cwd`.
It gains one check and one factory:

```
if (isTaskManagerProject(sessionCwd) && !chatOnly) {
  resourceLoaderOptions.extensionFactories += createTaskManagerExtension({ projectCwd: sessionCwd })
}
```

Decisions behind that shape:

| Choice                                  | Reason                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An extension factory, not `customTools` | The extension API provides `registerTool`, `sendMessage` (the wake channel), `appendEntry`, `setSessionName`, `setStatus` and `session_start`. A plain `ToolDefinition` has none of that. It also matches `createPieBuiltinExtensions`.                                                           |
| Gated by `cwd` in the server            | The client cannot ask for the tools, so `POST /api/agent/[id]` with `set_tools` stays unable to select them. They never appear in another project.                                                                                                                                                |
| Not a tool preset                       | Custom presets are validated against `CANONICAL_CODING_TOOLS` (`lib/custom-tool-presets-shared.ts`) and `set_tools` against `lib/session-tool-selection.ts`; neither accepts these names. The tools are server-injected and outside the preset model by construction.                             |
| Carried through preset changes          | `resolveActiveToolNames` keeps registered non-coding tools, so choosing Read-only in this project still leaves the queue tools active. The coding preset keeps deciding only `read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`.                                                                     |
| Chat only is coerced                    | An empty selection makes the session `chatOnly`, which skips all extensions, so the tools would vanish and a persisted empty selection would strand the session. The server forces the full loadout in this project, and the composer shows a locked "Task manager" entry instead of "Chat only". |

Deletion stays clean: removing `lib/task-manager-extension.ts`, `lib/tasks/manager-project.ts` and
`lib/tasks/agent-tools.ts`, plus the handful of lines in `rpc-manager.ts` that name them, leaves
chat behaving as before. `lib/tasks/active-sessions.ts` keeps its existing read-only role.

## The tools

Ten tools, each mapped onto an existing queue operation. No tool contains SQL, and no tool accepts a
path other than a working directory, which goes through `normalizeCwd` and the same file-access
allow-list the board uses. A directory no session has used yet is refused with a message naming the
remedy; `authorizeCwd: true` approves the one the person named, and the approval is written to
`<agentDir>/pie-allowed-roots.json` so it outlives the process.

| Tool           | Arguments                                                                          | Backing code                                                          |
| -------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `task_list`    | `status?`, `cwd?`, `includeRuns?`                                                  | `queue.listTasks`, the runs table, every project's orchestrator status |
| `task_create`  | `title`, `description`, `cwd`, `authorizeCwd?`, `allowAskUser?`, `verifyCommands?` | `queue.createTask`                                                    |
| `task_update`  | `id`, the create fields                                                            | `queue.updateTask`                                                    |
| `task_move`    | `id`, `direction` or `position`                                                    | `queue.moveTask`                                                      |
| `task_delete`  | `id` \| `ids` \| `completed`, `cwd?`, `confirm`                                     | `queue.deleteTask`, `completedTaskIds`                                |
| `task_control` | `action`, `cwd?`, `id?`, `note?`                                                   | `start`, `pause`, `resume`, `abort`, `retry`, `markDone`              |
| `task_answer`  | `answer?`, `cancelled?`                                                            | `orchestrator.answer`                                                 |
| `task_config`  | `update?`: the queue-default fields                                                | `lib/tasks/config.ts`, the Queue defaults dialog's data               |
| `task_watch`   | `action`: `on` \| `off` \| `status`                                                | the extension's watch state                                           |
| `task_events`  | `afterId?`, `limit?`, `waitMs?` (at most 50 s)                                     | `store.listEventsSince`                                               |

`task_control` carries the remaining board actions rather than adding a tool per button; the actions
are the queue controller's, so errors map to the same codes the board already handles
(`task_locked`, `task_not_found`, `invalid_input`, `already_running`, `no_pending_question`).
`cwd` names the project for `task_list`, `task_control`, and `completed` deletion; `id` is enough
for operations on one task, because the task resolves its own project.

Rules attached to the tool definitions, in `promptGuidelines` and in `AGENTS.md`:

- `executionMode: 'sequential'` on every tool. Each project queue is serial; two concurrent claims
  in one project are a bug.
- Every result carries all project snapshots (state, active task, pending and attention counts) and
  the events newer than the session's cursor, so a single tool call always leaves the agent
  grounded.
- `task_control: 'start'` turns watching on (it returns the watch facts). `pause`, `resume`, `abort`
  and `retry` do not.
- Destructive actions (`task_delete`, `markDone`, clearing completed tasks, `abort`) require the
  `confirm` flag and are refused otherwise, with an explanation the model can act on. The queue's
  own guards still apply underneath, so confirmation is a habit, not a security boundary.
- Results truncate tails through the existing `clipOutputTail` bound (8 KiB) instead of returning a
  whole run log into the context.

## The event log

Status changes need durable storage, not an in-process callback: a session may be closed, the server
may restart, and the agent must be able to catch up. `lib/tasks/store.ts` keeps the events in the
same database as the tasks; the project-queue migration (`user_version = 5`) adds `project_key`, so
a digest can name the project an event belongs to:

```sql
CREATE TABLE task_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           INTEGER,              -- NULL for project-level events
  project_key       TEXT,                 -- projectIdentityKey(cwd)
  kind              TEXT NOT NULL,        -- claimed | settled | question | answered | queue | config
  status            TEXT,                 -- the task's status at the time, for digests
  summary           TEXT,
  origin_session_id TEXT,                 -- the session whose tool call caused it, if any
  created_at        TEXT NOT NULL
);

CREATE INDEX task_events_project ON task_events (project_key, id);

CREATE TABLE task_event_cursors (
  session_id    TEXT PRIMARY KEY,
  last_event_id INTEGER NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE task_manager_watch (
  session_id  TEXT PRIMARY KEY,           -- one row: at most one watcher at a time
  started_at  TEXT NOT NULL,
  wakes       INTEGER NOT NULL DEFAULT 0
);
```

Event writes go inside the transactions that already exist, never in a separate call:

| Transition                      | Event                                              |
| ------------------------------- | -------------------------------------------------- |
| `claimNext(projectKey)`         | `claimed`, the task id and its title               |
| `settleTask`                    | `settled`, the final status and summary            |
| `setPendingQuestion` (non-null) | `question`, the question and options               |
| `setPendingQuestion` (null)     | `answered`, the answer or a dismissal              |
| `setQueueState(projectKey)`     | `queue`, the new state and pause reason            |
| `markTaskDone`, `retryTask`     | `settled`, a human or agent override with its note |
| `recoverInterrupted`            | `queue`, a restart note                            |
| queue defaults written          | `config`, which fields changed                     |

The invariant this buys: a `task_events` row and the `tasks`/`project_queue_state` row it describes
are either both written or both absent, so the agent can never be told about a state the board
does not show. The one exception is `config`: the defaults live in a JSON file, so its event is appended
right after the file write rather than sharing a transaction with it. A missing `config` event is
not a failed configuration.

Only a real transition is an event. A write that changes nothing appends nothing, and a change to
`project_queue_state.active_task_id` alone does not append: the claim it belongs to is already
`claimed`.

## Implementation status

| Phase | State       | What exists                                                                                    |
| ----- | ----------- | ---------------------------------------------------------------------------------------------- |
| 1     | Done        | Schema `user_version = 5`, per-project events, per-session cursors, watch row                  |
| 2     | Done        | The tools over the per-project queue controller                                               |
| 3     | Done        | The project directory and `POST /api/tasks/manager`                                           |
| 4     | Done        | The extension factory and its conditional injection                                           |
| 5     | Done        | Watch polling, liveness, budgets, replay; a digest spans every project                        |
| 6     | Done        | Browser entry point, chip, i18n, origin mark                                                  |

## Delivery

Two paths, both reading the same cursor. Neither is a new transport.

### Pull: every tool result carries the delta

A tool call reads `last_event_id`, includes the newer events in its result and advances the cursor
in a small transaction. This is the baseline: a session that never watches still sees every
transition the next time it acts.

### Push: `task_watch`

`task_watch: 'on'` makes the extension do four things:

1. Poll `task_events` every 1.5 s, the same polling design the board uses, and **peek**: the cursor
   only advances after a digest is actually sent.
2. Send only while the session is idle. A digest delivered with `deliverAs: 'followUp'` to a session
   that is mid-turn is parked in the agent's follow-up queue and arrives with the next prompt, hours
   later and no longer true. The watch waits for the turn to end and the events are still unseen.
3. Coalesce new events into one digest and deliver it with
   `pi.sendMessage({ customType: 'pie-task-event', content, display: true }, { triggerTurn: true, deliverAs: 'followUp' })`.
   The custom message is in the model's context and in the transcript, so the user can see what woke
   the agent.
4. Register `registerSessionLivenessProvider({ name: 'task-manager-watch', isActive })` so the ten
   minute idle eviction does not end the watch.

A digest is one short block: the events, then every queue as it was when the digest was written.
Only projects that are not idle are listed, so the block stays short.

```
- settled task 7 DONE in /repo: bun run typecheck passed
/repo RUNNING, task 8 running; /repo/app IDLE; wake 3 of 100, as of 2026-01-01T14:35:12.000Z
```

The `as of` time is there because the queue state in a digest is a snapshot, and a late delivery
must not read as current. The tools are ground truth: the tool guidelines tell the agent to call
`task_list` before answering, and `task_events` with `afterId` always recovers a missed batch.

Only decision points wake the agent: claim, settle, question, queue pause/resume/idle, abort.
Activity lines and tool-stream noise never do.

| Guardrail      | Rule                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit start | Watch begins only through `task_watch: 'on'` or `task_control: 'start'`. Reopening a session never resumes it.                           |
| Idle session   | A wake is only sent while the session is idle; a busy session keeps its events unseen until its turn ends.                               |
| Budget         | 100 wakes or 2 hours per watch, whichever comes first. Reaching it leaves a "watch ended" note and stops.                                |
| Natural end    | Once the watch has seen work, every queue being `IDLE` with no pending or running task ends it at the next poll, even when nothing new happened. |
| Origin filter  | Events whose `origin_session_id` is this session are not re-delivered; the tool result already showed them.                              |
| Single watcher | One row in `task_manager_watch`. A second `task_watch: 'on'` from a live session is refused with the watcher's session id.               |
| Restart        | A restart drops the watch and the liveness provider. The next session start replays the backlog as one digest with no triggered turn.    |
| Stale row      | A watch row past its time or wake budget no longer blocks a new watcher; the session that opens it reclaims the row.                     |
| Visible        | A "Watching" chip with a Stop control names the watching session; stopping the queue or the page does not silently keep spending tokens. |
| Shutdown       | `session_shutdown` clears the polling timer and releases the liveness provider.                                                          |
| No extra turn  | Ending a watch appends a note without `triggerTurn`; only a wake spends a turn.                                                          |

The rejected alternative was a long-poll-only design (`task_events` with `waitMs`) as the sole
channel. It works inside one turn but costs a model round trip per wait and cannot do anything while
the session is idle. It remains as a fallback tool, not the mechanism.

## Letting the agent answer a task

A task with `allowAskUser` can still reach a person through the board and Web Push; that path is
unchanged. The orchestrator learns about the question in the same digest and has `task_answer`.

Policy, decided and recorded here:

- **Default is relay.** The orchestrator summarises the question, states the options, and asks the
  user. It answers only when the user tells it to, or when the question is answerable from the task
  description it wrote and the user has said to handle those itself.
- **One answer, one record.** `task_answer` writes the `answered` event with the text used, so the
  transcript and the board agree on who answered and what was said.
- **Dismissal is not consent.** A cancelled question is reported as such, and the agent is told to
  continue with a stated assumption rather than treat silence as approval, mirroring the tool's
  existing behaviour.

## Queue control policy

- `start` is allowed. Driving the queues is the point of the feature; each project still pauses on
  `BLOCKED`/`FAILED` and still runs one task at a time, while another project may be running.
- `abort` requires `confirm`, and the digest that follows names the task and the reason.
- `delete`, `markDone` and clearing completed tasks require `confirm` and a note. The board keeps
  its own confirmation, because a person's click is not the agent's claim.
- The queue defaults (`task_config`) are writable, because the orchestrator often knows the right
  verification command for the repository it is queuing work for. Every write produces a `config`
  event so the change is visible in chat and to the next reader.

## Interface

- **Entry point.** The task bar in `components/TaskWorkspace.tsx` has a "Task manager" action. It
  calls `POST /api/tasks/manager`, opens the newest conversation in that project, or a fresh
  composer when there is none. The project also appears in the sidebar under its alias.
- **Forced loadout.** The composer's tool selector stays as it is, but in that project the server
  ignores the selection for the loadout: any coding preset changes only the coding tools, and Chat
  only has no effect. The queue tools ride beside whatever the person picks.
- **Watch state.** `GET /api/tasks` includes the one watch row, so the board shows "A chat session
  is watching the queues" while a wake budget is being spent; the watcher is not per project. A wake also lands in the transcript as
  a `pie-task-event` message, so the chat itself is never silently active.
- **Event cards.** `pie-task-event` custom messages render through the generic custom-message card.
  A dedicated compact renderer (task id, title, status, verification) can follow without touching
  the delivery path.
- **Origin marker.** A task row shows a small "Chat" mark when a session queued it. It comes from
  the `created_by` column `task_create` writes, not from parsing descriptions.
- **No new mode.** The manager is a chat session, so `?mode=tasks` and the queue board are
  untouched. The board remains the place to look at the queue; chat is the place to talk about it.

## Security and failure containment

- The tools exist only in one directory. They are not reachable from the browser's `set_tools`, from
  a custom preset, from a task's child process, or from any other project.
- The agent uses the queue controller, so `cwd` validation, command length bounds, the per-project one-running
  claim and the fencing tokens apply unchanged. No raw SQL passes through a tool.
- Approving a directory is the one decision the agent can make that widens its own reach, so it is
  explicit (`authorizeCwd`, allowed on create and on update), it is the person's directory by the
  rule in `AGENTS.md`, and it is recorded in durable storage rather than in a hidden process cache.
- A task's child process never loads the task manager extension: injection happens in the in-process
  session path only, and task children are spawned CLI processes that load `ask_user` and nothing
  from Pie's own extension factories.
- `AGENTS.md` is created once and never rewritten, matching the project rule that user data is not
  rebuilt. Deleting it restores Pi's default behaviour, not a crash.
- The watcher is unbounded in duration but bounded in wakes and time, and it is visible and
  stoppable. An agent that keeps watching cannot outlive its budget.
- A project's queue still refuses to run when another process holds its
  `pie-task-locks/<sha256(projectKey)>.lock`; the tools surface that conflict instead of pretending
  to start. Other projects are unaffected.

## Verification

Testing is manual; the project keeps no tests. Open the task manager project, send a
message, and watch the tools read and change the queues; add, move, and delete one task by hand.
Then queue a task in a second project, start both from the same conversation, and confirm the
digest and `task_list` name each project and its own state.

## Implementation phases

| Phase | Deliverable                                                           | Exit criterion                                                                      |
| ----- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1     | Schema v5, per-project events, cursor reads                            | A settle and its event are visible in one transaction; a restart keeps both.        |
| 2     | `lib/tasks/agent-tools.ts` with the ten tools                         | Tools drive a temporary queue end to end without HTTP.                              |
| 3     | `lib/tasks/manager-project.ts`, `POST /api/tasks/manager`             | The directory and `AGENTS.md` appear once and only when needed.                     |
| 4     | `lib/task-manager-extension.ts`, injection in `rpc-manager.ts`        | A session in that directory exposes the tools; the same session elsewhere does not. |
| 5     | Watch, liveness, budgets, replay, single-watcher guard                | A settle wakes an idle session once, and a restart replays it without waking.       |
| 6     | Orchestrator action, locked tool entry, watch chip, origin mark, i18n | The flow is usable from the browser, keyboard included.                             |

## Settled decisions

| Decision                  | Value                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Shape                     | An ordinary chat session in a dedicated project, not a mode, daemon or subagent runtime                 |
| Project identity          | A real directory `<agentDir>/task-manager` with a sidebar alias "Task Manager"                          |
| Tool surface              | Queue controller operations only; no raw database access                                                |
| Tool availability         | Server-injected extension, gated by exact `cwd`; never selectable, never in a preset                    |
| Status delivery           | Durable `task_events` log, pull-on-tool-result by default, explicit `task_watch` push on change         |
| Wake policy               | Automatic on decision points, opt-in per watch, 100 wakes or 2 hours, one watcher, no resume on restart |
| Question answering        | Relay by default; the agent may answer when the user authorises it, and the answer is recorded          |
| Queue control             | Per project: `start` allowed; `abort`, deletes and `markDone` need explicit confirmation                 |
| Concurrency               | One task per project; different projects may run at the same time                                       |
| Orchestrator instructions | An `AGENTS.md` written once in the project, editable afterwards, never rewritten by Pie                 |
| Coupling                  | One extension factory in `rpc-manager.ts`, removable with the rest of the feature                       |
