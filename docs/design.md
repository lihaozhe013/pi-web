# Interface Principles

## Conversation is the workspace

The interface should feel like a carefully organized agent conversation, not a developer dashboard.
Keep frequent actions nearby and reveal secondary information on demand.

The current layout uses a session sidebar, a central conversation and composer, and an optional
information sidebar opened from the toolbar. Project groups help locate conversations; they are not
project management. A new session chooses a directory, and an existing worktree is simply another
directory.

The information sidebar is currently 400px wide. It overlays the conversation when space is limited
and fills phone widths. Close and Escape restore focus to the trigger; modal overlays contain
keyboard focus.

## Quiet, clear, polished

- Use soft surfaces, restrained corners, and useful whitespace rather than many borders.
- Prioritize readable conversation text; the current default baseline is 16px.
- Use semantic theme variables instead of building another hard-coded skin.
- Do not communicate state through color alone. Keep keyboard focus visible.
- Animate only to explain changes and honor reduced-motion preferences.
- Prefer a good default over unnecessary appearance settings.

## Settings and appearance

Settings stays in a modal over the conversation. Desktop navigation uses a left-hand category list;
phones use a category picker. General contains behavior and language; Appearance contains themes,
fonts, sizes, conversation width and a live preview. The theme gallery is a native disclosure,
collapsed initially to keep font controls near the top; a theme search result opens it
automatically. Visited categories stay mounted so switching does not discard an editor's draft.

Interface size (14px baseline), chat text size (16px) and monospace content size (15px) are
independent. UI text retains its hierarchy relative to the interface baseline. Large UI sizes also
grow virtual session rows. Chat text controls messages and the composer; monospace size controls
inline code, code blocks, diffs and tool output. Font names and weights remain separate for UI and
monospace. The preview reuses the Markdown renderer and code/output styles. Changes are immediate
and stored only in the browser; font-group resets leave the other font and chat size alone.

The settings search matches translated names, descriptions and English/Chinese aliases across
categories. Appearance and general controls have stable destinations; management categories remain
entry points to their own editors and content searches. It does not index configuration values,
credentials, sessions or remote catalogues. Conditional results explain project, platform or sign-in
requirements. Selecting a result focuses and reveals its destination without changing its value.
Escape first clears an active search, then closes Settings on the next press.

## Execution feedback

Show what the agent is doing, whether it finished, and what went wrong without filling the
conversation with every low-level event.

The live run status is one row directly above the composer, outside the transcript: provider
waiting, thinking, reading, execution and compaction report there, aligned to the composer's content
width. It stays visible while the user scrolls history, and its fixed single-line height keeps the
composer still. Concurrent work is summarized as one line (`Reading 3 files · Running bun test`): a
kind with a single running call keeps its concrete detail, a kind with several becomes a count, and
the full text remains in the tooltip. A call the model is still writing is named by its tool
(`Preparing edit…`) instead of leaving the row empty until execution starts. The row keeps its
height for the whole run, dropping only the text while a visible answer streams, so the composer
never moves mid-run. It disappears when the run ends.

Current main-transcript behavior:

- Thinking and exploration calls (`read`, `grep`, `find`, `ls`) draw no card: the composer status
  row carries them while they run, naming the file, search pattern, or directory, and their result
  stays out of the transcript whether it succeeded or failed.
- A tool card appears when the call actually starts executing, and not while the model is still
  writing its arguments: a half-streamed JSON blob would intrude, while a running call's card is the
  progress the user asked for. A shell card therefore opens at execution with its live output and
  leaves the main transcript after success; failures retain an inspectable error summary.
- Write/edit cards default to expanded. Patch cards fold after completion.
- A command the user ran themselves (`!`) keeps its live card, because its progress is the answer
  they asked for.
- Long shell output initially shows its last 16 lines, with access to all output.
- Explicit expansion choices override defaults for retained cards.
- Errors, truncation notices, and necessary warnings remain visible.

Visual filtering must not remove full history, export content, persisted data, or agent context.
Distinguish provider waiting, thinking, reading, execution, and compaction. Clear transient status
when a run ends. Partial output is not success: it keeps a running card open and is never shown as a
finished result.

Load syntax highlighting on demand. Unknown languages and streaming input must remain readable
without it. Draw tool cards as borderless panes: a surface tint lifts the card off the transcript
and the code, diff or output inside it sits a shade deeper, so color rather than a frame separates
the body from the page.

## Questions near the composer

Model-issued `ask_user` questions use a non-modal panel directly above the composer, aligned to its
content width. Options and a free-form answer share one panel; choosing an option does not submit it
until Send answer. The normal composer, its draft, and attachments remain independent. Collapsing or
Escape retains the pending question and local answer; Skip explicitly returns no answer. Submission
disables duplicate sends, retains the answer on transport failure, and offers an inline retry. Focus
is not stolen when a question arrives.

Long question bodies scroll within the panel. The footer stays reachable on narrow screens. The
pending question does not also show a raw tool card in the main transcript; completed results remain
inspectable and raw history is unchanged. Other extensions continue using their existing dialogs and
custom panels.

## Navigation and accessibility

The conversation directory uses a lightweight overlay entry point rather than a permanent column.
Keep it available even when history fits without scrolling. Open subagent conversations centrally
instead of adding workspace tabs.

Check desktop, narrow desktop, and phone layouts. Preserve predictable return, close, cancel, and
focus behavior. Do not add modes when simpler interaction suffices.
