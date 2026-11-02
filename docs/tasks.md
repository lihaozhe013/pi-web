# Serial Task Orchestrator

A local, strictly serial task queue: a small Jira for one person. Tasks are queued, claimed one at a
time, and each one is executed by a brand-new Pi agent process with its own session. When the
process ends, its context ends with it; the next task starts from an empty window.

This document is the design. It describes what will be built, why it is built this way, and which
invariants must survive later changes. Nothing here is implemented yet.

## Why this is not the boundary the project had

`docs/README.md` and `docs/architecture.md` previously ruled out a multi-agent orchestrator and a
subagent/queue feature. This document replaces that part of the boundary with a narrower rule:

- **Allowed:** one serial queue, one active task at a time, executed as a Pi CLI child process
  driven over Pi's own RPC protocol.
- **Still refused:** parallel execution, agent profiles, worktrees, a second agent protocol,
  subagent control tools, and any orchestration of Pi internals.

The queue owns scheduling, persistence, and progress reporting. It owns no agent capability: it
starts the installed Pi CLI and speaks Pi's documented RPC records. Deleting `lib/tasks`,
`app/api/tasks`, and `components/TaskWorkspace*` must leave the chat experience untouched.

## Goals

- **Strict serial execution.** Never two tasks at once, in one process or across processes.
- **Zero context bleeding.** Every task runs in a fresh OS process with a fresh session; the queue
  never reuses a session to save tokens.
- **Durable queue.** Survives reloads and server restarts; every transition is a single SQLite
  transaction with the state guard in the SQL itself.
- **Human interruption.** The running task can be stopped for real (process tree killed), and a task
  may ask a question when the user allowed it.
- **Reviewable work.** Each task leaves an ordinary Pi session that the chat view can render, plus a
  verification result and, when enabled, a commit.

## Non-goals

- Parallelism, worker pools, priorities beyond manual rank, dependencies between tasks.
- Pull requests, branches, worktrees, or pushes. The queue may commit; it never publishes.
- Multi-user operation, remote execution, or a hosted service.
- Per-task model or tool configuration in the first version (the Pi settings decide).
- Providing a task-specific rendering of agent output. The transcript is Pi's.

## Layering and coupling

```
components/TaskWorkspace*          view: queue board, task editor, live activity
        │ HTTP (polling)
app/api/tasks/**                   thin routes: validation, delegation, no logic
        │
lib/tasks/orchestrator.ts          the only loop: claim → run → gate → commit → settle
        ├── lib/tasks/queue.ts     QueueController: CRUD, ordering, state guards
        ├── lib/tasks/store.ts     SQLite (WAL), migrations, the only module with SQL
        ├── lib/tasks/runner.ts    one task → one RPC child → one outcome
        ├── lib/tasks/rpc-session.ts  spawn/read/write/kill the child, record dispatch
        ├── lib/tasks/prompt.ts    the task prompt and the unattended rules
        ├── lib/tasks/gate.ts      verification commands
        └── lib/tasks/git.ts       auto-commit
```

| Boundary                             | Cost                                                                                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent runtime (`lib/rpc-manager.ts`) | No import in either direction. The two systems share only the agent directory and Pi's session directory. The one contact point is a read-only guard the agent route consults so a running task's session stays read-only (see below). |
| Pi                                   | Uses the installed CLI and its documented RPC records. No new protocol, no SDK internals.                                                                                                                                              |
| Web layer                            | Seven REST routes underneath one client hook. The board can be removed without touching chat.                                                                                                                                          |
| Packaging                            | No new dependency. Storage uses Node's built-in `node:sqlite`; the CLI is resolved from the app's own `node_modules`.                                                                                                                  |
| Desktop shell                        | None. `src-tauri/` and `packaging/desktop.mjs` are untouched.                                                                                                                                                                          |

### Alternatives considered

| Option                                                       | Rejected because                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-process SDK sessions via `startRpcSession`                | A hung or looping agent cannot be killed, only asked to stop; an unattended run can block on `ask_user`; the task would share the server's process and its idle timers.                                                           |
| `pi --mode json` child                                       | One-shot and one-directional: no interactive question channel, so this design's `ask_user` requirement fails.                                                                                                                     |
| `pi --mode rpc` child, `RpcClient` from the SDK              | Still the chosen mode; the SDK client is rejected because it does not surface `extension_ui_request` records (checked in 1.4.0), which is exactly the channel a question needs. The orchestrator ships a small client of its own. |
| A separate daemon spawned by `bin/pie.js`                    | Duplicate lifecycle, agent-directory resolution, and shutdown handling with no benefit: the UI needs the server anyway.                                                                                                           |
| Reading the session file instead of the child's event stream | Loses the question channel, adds partial-write races, and reports progress later than the events do.                                                                                                                              |

## Process model

Each task spawns exactly one Pi child:

```
node <app>/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js \
  --mode rpc \
  --session-id <new uuid> \
  --name "T<id> <title>" \
  [--no-approve | --approve] \
  [-e <app>/lib/ask-user-cli-extension.ts]
```

- The CLI script is resolved from the app's own `node_modules` and started with `process.execPath`,
  never through a shell, so Windows needs no `.cmd` handling and a portable install works the same.
  This mirrors the reasoning in `lib/node-cli.ts`.
- The child's working directory is the task's `cwd`, so Pi discovers that project's settings,
  skills, prompt templates, and `AGENTS.md` exactly as a CLI run would.
- Approving project-local files is refused by default (`--no-approve`) unless `lib/project-trust.ts`
  already trusts that directory. An unattended run must not be the first thing that executes a
  repository's `.pi/extensions`.
- The session is persisted. It is an ordinary Pi session: it appears in the sidebar once the session
  list refreshes (its cache TTL is 30 s), renders through the normal transcript, and can be read
  after the task finished.

### Why RPC and not print/JSON mode

| Need                                  | `--mode json`                    | `--mode rpc`                                 |
| ------------------------------------- | -------------------------------- | -------------------------------------------- |
| Fresh process, real kill, exit status | yes                              | yes                                          |
| Live events for the board             | yes                              | yes                                          |
| Soft stop while a run is active       | no                               | yes (`abort`)                                |
| Extension dialogs (a question)        | no UI host, `ctx.hasUI` is false | `ctx.hasUI` is true over the UI sub-protocol |

RPC is the only mode that satisfies both the isolation requirement and the interactive-question
requirement. Print and JSON modes remain useful for one-off scripting, not for this queue.

### RPC client obligations

Pi's `docs/rpc.md` and `docs/rpc-extension-ui.md` are the authority. The client must:

- Frame on LF only. Do not use `readline`: it also splits on U+2028/U+2029, which are legal inside
  JSON strings. Strip a preceding CR.
- Correlate commands by their `id`; command handling is asynchronous.
- Read stdout continuously and honor stdin backpressure; a stalled reader stalls the child.
- Treat stderr as diagnostics, never as protocol data.
- Know that `agent_end` ends one low-level run, while `agent_settled` is the point after which Pi
  will not continue automatically. A task run ends at `agent_settled` with no pending question.
- Close stdin for an orderly shutdown; escalate to signals when the child does not exit.
- Handle a dead child at any point, including between `prompt` and `agent_settled`.

### Killing

- Graceful: `{"type":"abort"}`, then close stdin, then wait.
- Hard: after the grace period (5 s by default), kill the whole tree —
  `process.kill(-pid, 'SIGKILL')` on POSIX (requires a detached child), `taskkill /PID <pid> /T /F`
  on Windows.
- Any exit the queue did not ask for is a failure, and the task is settled accordingly.

## Storage

`node:sqlite` (`DatabaseSync`) at `<agentDir>/pie-tasks.db`, that is, next to Pie's other state and
never inside a user's repository. `PRAGMA journal_mode = WAL` (the returned mode is checked and a
fallback to `delete` is logged), `synchronous = NORMAL`, `busy_timeout = 5000`, `foreign_keys = ON`.
Schema changes are numbered steps gated by `PRAGMA user_version`.

A database module is a per-process singleton (a `globalThis` key, as `lib/custom-tool-presets.ts`
does) because route handlers are bundled separately and hot reload re-evaluates modules.

```sql
CREATE TABLE tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','IN_PROGRESS','DONE','BLOCKED','FAILED')),
  rank             INTEGER NOT NULL,
  cwd              TEXT NOT NULL,
  allow_ask_user   INTEGER,              -- NULL: use the queue default
  verify_commands  TEXT,                 -- JSON array; NULL: use the queue default
  auto_commit      INTEGER,              -- NULL: use the queue default
  session_id       TEXT,                 -- the Pi session of the current attempt
  claimed_token    TEXT,                 -- fencing token for the active claim
  pending_question TEXT,                 -- JSON { id, question, options, asked_at } while waiting
  attempts         INTEGER NOT NULL DEFAULT 0,
  result_summary   TEXT,
  exit_code        INTEGER,
  verify_output    TEXT,                 -- tail, bounded
  commit_sha       TEXT,
  run_started_at   DATETIME,
  created_at       DATETIME NOT NULL,
  updated_at       DATETIME NOT NULL,
  finished_at      DATETIME
);

CREATE INDEX tasks_queue ON tasks (status, rank, id);

CREATE TABLE task_runs (                 -- one row per attempt; retries keep their history
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt        INTEGER NOT NULL,
  status         TEXT NOT NULL,          -- final status of that attempt
  session_id     TEXT,
  exit_code      INTEGER,
  verify_exit    INTEGER,
  output_tail    TEXT,
  commit_sha     TEXT,
  started_at     DATETIME NOT NULL,
  finished_at    DATETIME
);

CREATE TABLE queue_state (               -- exactly one row
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  state           TEXT NOT NULL,         -- IDLE | RUNNING | PAUSED
  paused_reason   TEXT,
  active_task_id  INTEGER,
  updated_at      DATETIME NOT NULL
);
```

`rank` stays an integer: the queue is small, inserts take `max(rank) + 10`, and any reorder rewrites
the pending segment as 10, 20, 30, … inside one transaction. No fractional keys, no gaps to
maintain, deterministic order with `ORDER BY rank, id`.

## Queue controller

`lib/tasks/queue.ts` is the only writer. Every guard is expressed in SQL, not only in JavaScript, so
a stale caller cannot win a race it lost.

| Operation            | Rule                                                                                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTask`         | Title required; `cwd` must exist and pass the file-access allow-list check; rank appended at the end; status `PENDING`.                                                                                                                                                                                     |
| `updateTask`         | `IN_PROGRESS` is refused with `TaskLockedError`.                                                                                                                                                                                                                                                            |
| `deleteTask`         | `IN_PROGRESS` is refused. Other statuses may be deleted; `task_runs` follows by cascade.                                                                                                                                                                                                                    |
| `moveTask`           | Reorders within the pending segment only; a non-pending task is refused. Accepts "move up", "move down", or an absolute position.                                                                                                                                                                           |
| `claimNext`          | One `BEGIN IMMEDIATE` transaction: assert no row is `IN_PROGRESS`; select the lowest `rank`/`id` `PENDING` row; update it to `IN_PROGRESS` with a fresh `claimed_token`, `attempts + 1`, and `run_started_at`, `WHERE id = ? AND status = 'PENDING'`; require `changes === 1`. No pending row means `null`. |
| `settle`             | One transaction: the final status, `result_summary`, `exit_code`, `finished_at`, a `task_runs` row, and `queue_state`. The update is conditioned on the task still being `IN_PROGRESS` with the caller's token.                                                                                             |
| `retryTask`          | `BLOCKED`/`FAILED` → `PENDING`. Attempts are counted at claim time.                                                                                                                                                                                                                                         |
| `markDone`           | Human override, recorded with a note; the board asks for confirmation.                                                                                                                                                                                                                                      |
| `recoverInterrupted` | At start-up, a row left `IN_PROGRESS` becomes `BLOCKED` with `result_summary = "orchestrator restarted during the run"`, because its child died with the old server.                                                                                                                                        |

### State machine

```
PENDING ──claim──► IN_PROGRESS ──gate passed, commit ok──► DONE
                        │
                        ├── non-zero exit / crash / timeout ──► FAILED
                        ├── verification command failed ─────► BLOCKED
                        └── aborted by the person ───────────► BLOCKED

FAILED, BLOCKED ──retry──► PENDING (attempts counted again)
DONE, FAILED, BLOCKED ──delete/edit──► allowed
IN_PROGRESS ──edit/delete/reorder──► refused (HTTP 409, code task_locked)
```

`FAILED` and `BLOCKED` are distinct because they mean different things to the person reading the
board: the process did not survive versus the process succeeded but the work did not pass. Both
pause the loop; neither retries on its own.

## Orchestrator loop

`lib/tasks/orchestrator.ts` is a per-process singleton (a `globalThis` key) plus one
`proper-lockfile` lock at `<agentDir>/pie-tasks.lock` so that two servers — a second checkout, or a
stale process — cannot both drive the queue.

```
start()
  ├─ take the lock, recoverInterrupted(), set state RUNNING
  └─ loop:
       if state is PAUSED or stopping: stop
       task = claimNext()
       if task is null:
            state = IDLE, notify "queue complete", stop
       else:
            run(task)            — see below
            on DONE: continue
            on BLOCKED/FAILED: state = PAUSED with the reason, notify, stop
```

`run(task)`:

1. Build the prompt (`lib/tasks/prompt.ts`): title, description, the verification commands, the
   working directory, and the unattended rules. The rules forbid asking when `ask_user` is off,
   require the work to happen in this directory, and require the final message to state what
   changed, what was verified, and what is left.
2. Start the child (`lib/tasks/rpc-session.ts`) with a new session id and the task name.
3. Send `prompt` and wait for `agent_settled`. Events update `last_activity` for the board and fill
   a bounded in-memory ring buffer (64 KiB) for the live tail. A watchdog settles the task as
   `FAILED` after the task timeout (60 min default).
4. `lib/tasks/gate.ts` runs the verification commands in the task's `cwd`. Non-zero or timeout means
   `BLOCKED`, with the tail of the output as the summary.
5. `lib/tasks/git.ts` optionally commits. A failure here does not fail the task; it is recorded.
6. `settle`, including the session id, exit code, and a short summary.

Control operations:

| Operation | Effect                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| `start`   | Acquires the lock, recovers, runs the loop. Refused while one is running.                                         |
| `pause`   | Sets `PAUSED`; takes effect between tasks, never mid-run.                                                         |
| `resume`  | Clears the pause and restarts the loop.                                                                           |
| `abort`   | Sends `abort`, waits, then kills the tree; settles the task as `BLOCKED` (`aborted by user`) and pauses the loop. |

Aborting settles as `BLOCKED` rather than rolling back to `PENDING`, because an abort usually means
"this task is wrong": rolling it back would let `resume` immediately repeat the same mistake.
Explicit `retry` is the way back.

Shutdown: `instrumentation-node.ts` already owns SIGINT/SIGTERM handling for streams and sessions.
It gains one call that kills the active child and settles its task as `BLOCKED`, so a server restart
never leaves a zombie agent writing into a directory the user believes is idle.

Notifications reuse the existing Web Push path (`lib/web-push.ts`, `app/api/push`): queue complete,
task failed or blocked, and — importantly — a question waiting.

## A question during a task

`ask_user` is not rewritten. `lib/ask-user-extension.ts` is already transport-agnostic: it calls
`ctx.ui.select(...)`/`ctx.ui.input(...)` and appends the `ASK_USER_OTHER_LABEL` sentinel option. In
RPC mode those calls become `extension_ui_request` records with `ctx.hasUI === true`, so the same
code works in a child.

The only addition is a two-line entry point that lets the CLI load the same module as a file
extension (Pi loads TypeScript extensions with jiti and requires a default-export factory):

```ts
// lib/ask-user-cli-extension.ts
import { createAskUserExtension } from './ask-user-extension';

export default createAskUserExtension().factory;
```

Parent-side handling:

- **Recognition.** A `select` request whose options include `ASK_USER_OTHER_LABEL` is a question; a
  bare `input` request from the same child is its free-form follow-up. No protocol extension and no
  duplicated tool definition.
- **Presentation.** The question is stored on the task (`pending_question`, JSON with the RPC
  request id, question, and options), so a reload of the board still shows it, and it is rendered by
  the existing `AskUserPanel` in the workspace and above the composer while Web Push announces it.
- **Answering.** Choosing an option replies with `value` directly. Writing an answer replies with
  the sentinel first and then with the text to the follow-up `input` request — the same two-step
  flow the TUI uses, so the child needs no special case.
- **Dismissing.** A dismissed question replies `cancelled: true`, which the tool already reports as
  "not an answer"; the agent continues with a stated assumption rather than treating silence as
  consent.
- **Policy.** The queue has a default (`allowAskUser`, off) and each task may override it. When it
  is off the extension is not loaded at all, so the tool does not exist and the prompt says
  questions are not available. When it is on, the queue waits indefinitely — a serial queue that
  stops for a person is the point — while `abort` remains the escape hatch. The `timeout` field RPC
  supports is deliberately unused: a wall clock should not answer for the user.

One question at a time: the tool is already `executionMode: 'sequential'`, and the serial queue
means nothing else is running anyway.

## Verification gate

Defaults live in `<agentDir>/pie-task-orchestrator.json`; every field is optional and a task may
override `verify_commands` and `auto_commit`.

```json
{
  "verifyCommands": [],
  "verifyTimeoutMs": 600000,
  "taskTimeoutMs": 3600000,
  "allowAskUser": false,
  "autoCommit": false,
  "commitMessage": "chore(task): #{id} {title}"
}
```

- Each command runs in the task's `cwd` through the platform shell (`cmd /c` on Windows, `sh -c`
  elsewhere), with the process tree killed on timeout. Commands are the user's own configuration, so
  this is not an input-validation boundary; the file is written by the app or edited by the user,
  never by a task.
- An empty list means "no gate": the task is `DONE` when the agent exits cleanly, and the board says
  so plainly rather than implying verification happened.
- A failure settles `BLOCKED` with the tail of the failing command's output.
- Reading verification commands from a project's `.pi/` directory is not part of the first version:
  an unattended run must not be configured by files inside the repository it is changing.

## Auto-commit

Off by default. When enabled:

- The repository is located with `git -C <cwd> rev-parse --is-inside-work-tree`. Not a repository,
  or no changes, means "skip" and is recorded, never an error.
- Only what this run changed is committed. The baseline is captured before the agent starts
  (`git status --porcelain`), and the commit stages the paths that differ from that baseline.
  Changes that were already present when the task started are left alone.
- Commit only, never push, never amend, never touch branches or the index beyond staging those
  paths. A commit failure is recorded in `result_summary` and does not turn a verified task into a
  failure; the board shows "verified, not committed" instead.

## HTTP API

All routes are under `/api/tasks` and sit behind the existing `proxy.ts` origin check, the optional
web password, and `lib/json-response.ts`.

| Route                         | Purpose                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /api/tasks`              | `{ tasks, runs, orchestrator, config }`; `no-store`. Polled by the board.                   |
| `POST /api/tasks`             | Create. Body: title, description, cwd, allow_ask_user, verify_commands, auto_commit.        |
| `PATCH /api/tasks/[id]`       | `{ action: 'update' \| 'move' \| 'retry' \| 'markDone' }`. `409 task_locked` while running. |
| `DELETE /api/tasks/[id]`      | Same guard, same error.                                                                     |
| `POST /api/tasks/control`     | `{ action: 'start' \| 'pause' \| 'resume' \| 'abort' }`.                                    |
| `POST /api/tasks/[id]/answer` | `{ answer?: string, cancelled?: boolean }` for the pending question.                        |
| `GET /api/tasks/[id]/output`  | The live tail of the active task, from the in-memory buffer.                                |

Validation mirrors the rest of the app: bounded body, `cwd` must exist and be readable through the
existing file-access allow-list, and no path is ever accepted from the client for anything but a
working directory. Errors are `{ error, code }` with `409` for a locked task, `400` for invalid
input, `409` for orchestration conflicts (`already_running`, `no_pending_question`).

## Interface

The board is a second workspace, not a second dashboard grafted onto the conversation. It is
delivered in two steps so the chat surface is never destabilized by a navigation rewrite.

### Step 1 — a task workspace reachable from the sidebar

- `AppShell` gains a workspace switch driven by `?mode=tasks`, rendered as `<TaskWorkspace>` in
  place of the conversation and composer. With the parameter absent, nothing about the current chat
  view changes. No new route file, because `app/page.tsx` already owns `I18nProvider` and a second
  route would have to repeat the provider tree. The parameter name is the one the tabs use in step
  2, so the URL never changes.
- The session sidebar gains a "Tasks" entry above the session list; in the task view the sidebar
  shows the queue grouped by status (running, queued, blocked, done), so the left column keeps its
  meaning as "what exists here".
- The board: one row per task with a status marker, title, working directory, attempts, and elapsed
  time. Reordering by drag or by the arrow keys. Keyboard: `↑`/`↓` move within the queue, `Enter`
  edits, `Delete` removes, all disabled with an explanation while a row is running.
- Editing opens the task in the same right-hand slot the Runs panel occupies, which keeps the three
  columns familiar: list on the left, work in the middle, detail on the right.
- The running task shows one activity line (the same vocabulary as the chat composer: waiting,
  thinking, reading, running a command) plus a collapsed transcript tail. "Open session" navigates
  to `?session=<id>`, that is, into the ordinary conversation view, where the work can be read in
  full.
- A pending question appears in two places, both already styled: above the composer within the task
  view, and in the task's right-hand detail. It answers through `AskUserPanel`'s existing request
  shape rather than a second component.
- Polling: 1 s while a task is running or a question is pending, 5 s otherwise, suspended while the
  page is hidden and refreshed once on return. No new SSE machinery.
- Accessibility and responsiveness follow `docs/design.md`: semantic theme variables, visible focus,
  keyboard-only operation, reduced-motion respect, and the phone layout collapses to a single column
  with the detail becoming a full-height sheet.

### Step 2 — two modes behind one top bar

Once step 1 behaves, the workspace switch becomes visible chrome:

- The 36 px top bar carries: sidebar toggle, mode tabs (`Chat` | `Tasks`), the session name in chat
  mode, and the right-panel toggle.
- The present chat toolbar (history, name, branches, system prompt, tools, statistics) moves into
  the header of the right-hand panel in chat mode, grouped under "session".
- The right-hand panel becomes a mode-specific inspector: Runs/Execution in chat mode, task detail
  in task mode. Its collapse, resize, phone overlay, and focus rules are reused unchanged.
- Because that panel can be collapsed, closed on phones, and hidden entirely by a setting, the
  actions moved into it stay reachable: when the panel is not visible, the top bar shows an overflow
  button carrying the same actions (the pattern `mobileToolbarMoreOpen` already uses).
- Deep links: `?mode=chat|tasks`, `?task=<id>`, and the existing `?session=`/`?cwd=` which always
  imply chat mode. The chosen mode is remembered per browser tab through `lib/tab-session.ts` and
  restored after mount, never during the first render (the SSR hydration rule already documented
  there).
- `docs/design.md` is updated in the same change: the right panel stops being a read-only surface of
  the default page and becomes a mode-specific inspector that may hold session actions.

### A running task's session is read-only in chat

While a task is `IN_PROGRESS`, its session file is being appended by a child process. Opening it in
chat mode shows the transcript as it stood when read; sending a prompt there would make two writers
share one JSONL. The composer is therefore disabled for that session with an explanation, and the
agent route refuses a prompt for a session the queue is driving. Reading, copying, exporting, and
forking remain available.

This is the only place the chat runtime learns that the queue exists: the prompt handler asks one
read-only function (`lib/tasks/active-sessions.ts`, a global set of session ids the queue is
driving). Deleting the queue removes that single call, and the behavior degrades to the client-side
disabled composer instead of breaking.

## Security and failure containment

- An unattended run is never the first thing to trust a repository's local extensions:
  `--no-approve` unless the directory is already trusted.
- A task's `cwd` is validated like any other working directory and stays inside the same allow-list
  the file routes use.
- The queue writes only inside its own database, its lock file, its agent sessions, and — when
  explicitly enabled — the task's repository index.
- A verified task never becomes `DONE` because of a crashed process; a crash is always `FAILED`.
- Nothing in the queue calls an LLM to decide anything. Every transition is mechanical.
- The child runs with the same credentials as the user's own CLI. The queue must not be exposed to
  an untrusted network: it starts agents that can edit files on the machine.

## Testing

Only the relevant file per change, per `AGENTS.md`.

| File                                | Covers                                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/tasks/store.test.mjs`          | Temp-database creation, WAL selection, migration idempotence, rank rebalancing.                                                                             |
| `lib/tasks/queue.test.mjs`          | Atomic claim, the "no second IN_PROGRESS" assertion, lock guards returning `TaskLockedError`, ordering, recovery of an interrupted task.                    |
| `lib/tasks/rpc-session.test.mjs`    | A fixture child emitting scripted records: LF-only framing with U+2028 inside a string, request correlation, question round-trip, orderly close, tree kill. |
| `lib/tasks/runner.test.mjs`         | Success, non-zero exit, timeout, abort, and a question answered or dismissed.                                                                               |
| `lib/tasks/orchestrator.test.mjs`   | Claim → done → next, gate failure → blocked → paused, empty queue → notice, restart recovery.                                                               |
| `lib/tasks/git.test.mjs`            | Not a repository, no changes, baseline-dirty files untouched, commit failure recorded.                                                                      |
| `app/api/tasks/route.test.mjs`      | Status codes, `task_locked`, answer routing.                                                                                                                |
| `components/TaskWorkspace.test.mjs` | Reorder by keyboard, disabled controls while running, question rendering.                                                                                   |

`store.test.mjs` and `queue.test.mjs` use a temporary directory; no test touches the real agent
directory or a real repository.

## Implementation phases

| Phase        | Deliverable                                                 | Exit criterion                                                                                  |
| ------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1            | `store` + `queue` + tests                                   | Guards and ordering verified without any process involved.                                      |
| 2            | `rpc-session` + `runner` + `prompt` + fixture child + tests | A real CLI child runs one prompt to `agent_settled`, asks a question, and dies on request.      |
| 3            | `gate` + `git` + `orchestrator` + lifecycle wiring + routes | A queue drains unattended; a failed gate pauses it; a restart leaves nothing running.           |
| 4            | `TaskWorkspace` + `?mode=tasks` + i18n + docs               | The queue is fully operable from the browser, keyboard included.                                |
| 5 (optional) | Two-mode top bar, toolbar migration, inspector panel        | Chat is unchanged in behavior, with the moved actions still reachable when the panel is hidden. |

## Invariants to preserve

- One `IN_PROGRESS` row at most, enforced by the claim transaction, not by the loop.
- Every task attempt is a new session id and a new process; a session is never reused for a second
  attempt.
- `IN_PROGRESS` tasks cannot be edited, deleted, or reordered — from any client.
- A task's terminal state is written with its run record in one transaction.
- Killing the server leaves no live child process.
- The chat experience and the Pi agent runtime keep working if the queue is deleted.

## Open decisions already settled

| Decision               | Value                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| Execution boundary     | `pi --mode rpc` child process per task, one queue for all workspaces                              |
| Task working directory | Stored per task; the queue is global so strict serial order spans projects                        |
| Abort outcome          | `BLOCKED`, loop paused                                                                            |
| `ask_user`             | Queue default off, per-task override, wait indefinitely when enabled, Web Push, abort as the exit |
| Verification commands  | Global config plus per-task override; no project-local config                                     |
| Auto-commit            | Off by default; stages only this run's changes; never pushes                                      |
| Storage                | `node:sqlite` database in the agent directory                                                     |
| Interface roll-out     | Task workspace first, two-mode top bar second                                                     |
