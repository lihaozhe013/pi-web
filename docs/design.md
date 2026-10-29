# Interface Principles

## Conversation is the workspace

The interface should feel like a carefully organized agent conversation, not a developer dashboard.
Keep frequent actions nearby and reveal secondary information on demand.

The current layout uses a session sidebar, a central conversation and composer, and an optional
information sidebar opened from the toolbar. Project groups help locate conversations; they are not
project management. A new session chooses a working directory; Git repository relationships do not
change its identity.

The information sidebar is currently 400px wide. It overlays the conversation when space is limited
and fills phone widths. Close and Escape restore focus to the trigger; modal overlays contain
keyboard focus. A surface opened on the user's behalf — the automatic Runs panel — never takes
focus. The toolbar's Runs toggle opens the shell and codemode history in this surface, beside the
System and Tools entries; it starts closed.

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

Interface size (15px default), chat text size (16px) and monospace content size (12px) are
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
(`Preparing edit…`) instead of leaving the row empty until execution starts. The row also carries
the run's elapsed time, counted from its prompt for the whole run — waits, retries and compaction
included — and frozen at its reading while the row fades out. While reasoning or a call's arguments
stream, the row also carries the reply's live tokens-per-second — the same measurement the streaming
message's header badge shows — and it hides whenever the model is silent. The session statistics
popover shows end-to-end output speed including first-token waits, and approximate streamed output
speed after the first nonempty text, thinking, or tool-argument delta. The streamed metric shows its
response count and excludes responses shorter than 500 ms, missing usage, and older responses
without recorded stream timing. Provider-reported output includes the first chunk and may include
hidden reasoning, so this is not a precise model decode benchmark. A finished turn reports its own
totals once, beside its time: the tokens it billed under the final answer (the hover spells them
out), or in the process group's header when the turn has one. The row keeps its height for the whole
run, dropping only the text while a visible answer streams, so the composer never moves mid-run. It
disappears when the run ends.

Compaction reports the same way. A manual compaction runs without a prompt, so the row opens for it
too and says `Compacting context…` with the elapsed clock running; the result replaces the row's
words as it fades — `Compacted 128k → 41k tokens (87k saved)` — instead of a banner above the
composer. The composer carries no compact button that morphs into a second progress pill: while a
compaction runs the send button becomes **Stop**, the same place a run is stopped, because a
compaction holds the session the way a run does. A compaction error stays a dismissible alert above
the composer, where an error cannot be missed by not opening anything.

Current main-transcript behavior:

- Thinking and exploration calls (`read`, `grep`, `find`, `ls`) draw no card: the composer status
  row carries them while they run, naming the file, search pattern, or directory, and their result
  stays out of the transcript whether it succeeded or failed.
- A tool card appears when the call actually starts executing, and not while the model is still
  writing its arguments: a half-streamed JSON blob would intrude, while a running call's card is the
  progress the user asked for.
- Shell and codemode calls draw no card in the transcript, running, successful or failed. The
  composer status row names them while they run, and the Runs panel keeps their history: the toggle
  sits beside Tools in the toolbar, is closed by default, and stays open until the user closes it.
  The panel also opens itself with the first running command of a turn, and when the user switches
  to a conversation that is already running one, so a run is visible without a click. Closing it
  during a turn keeps it closed until the next turn. Where the sidebar would overlay the
  conversation it stays closed until the toggle or a phone action opens it. The panel separates
  active runs from history, with independent scrolling and newest first in each. History starts
  collapsed into a compact footer, leaving the active area more room; its heading toggles the
  section, and the choice stays in effect when the panel is closed and reopened. Active cards
  default open; completed cards remain in the active section for two seconds, showing their final
  status, then move to history and default closed. Multiple runs can remain active at once. Active
  and historical cards use blue for running, green for success, and red for errors, alongside status
  words and marks; cancelled runs remain neutral. Codemode's nested calls use their own status
  colors as compact subcards ahead of a script disclosure. Closing the panel does not discard
  anything.
- Write/edit cards default to expanded. Patch cards fold after completion.
- A command the user ran themselves (`!`) keeps its live card in the transcript, because its
  progress is the answer they asked for. It also appears in the Runs panel so the history is
  complete.
- Long shell output in the Runs panel initially shows its last 40 lines, with access to all output.
- Explicit expansion choices override defaults for retained cards.
- Errors, truncation notices, and necessary warnings remain visible.

Visual filtering must not remove full history, export content, persisted data, or agent context.
Distinguish provider waiting, thinking, reading, execution, and compaction. Clear transient status
when a run ends. Partial output is not success: a running run stays running while its partial output
grows, and it is never shown as a finished result.

Load syntax highlighting on demand. Unknown languages and streaming input must remain readable
without it. Draw tool cards as borderless panes: a surface tint lifts the card off the transcript
and the code, diff or output inside it sits a shade deeper, so color rather than a frame separates
the body from the page. The Runs panel uses the same tinted card surfaces and inset output panes.

Motion explains a change; it never decorates one. A card fades in when its call starts, its status
mark fades when it changes, and its body folds open and shut. A user-run command that leaves after
its short reading hold fades and folds away where it stood. Only a card that lived in this page
moves: the card remembers whether the call was still running at mount, so restoring a session,
re-reading the same message, scrolling history or re-grouping a turn replays none of it. The run
status row above the composer is always in the stack: it folds open with the run, folds away when
the run ends, and only its words change in between, so the composer never jumps under the user's
cursor. In the Runs panel, new active cards fade in, their bodies fold when toggled, and completed
cards fade and fold out of the active section as their collapsed history cards appear. Restored
history does not replay entrance motion. All motion is opacity, transform or a box size;
`prefers-reduced-motion` makes the transitions instant without changing the two-second reading hold.

## Copying a turn

A turn carries one copy entry under its last message, always visible, never a hover-only fragment.
Per-message copy buttons are gone; a message keeps its own actions (edit, fork), and the space they
and the removed buttons used no longer separates the messages of one turn: they sit 10px apart,
while a turn keeps its own separation from the next.

The entry opens the sidebar's "New" dialog language with three scopes:

- **Conversation**: the prompt and the agent's replies, without tool calls.
- **Kept record**: the replies plus every step the transcript still shows, so edits, patches and
  questions arrive with their arguments and stored results.
- **Execution log**: the kept record plus the shell and codemode runs the Runs panel lists, with the
  structured details a tool recorded.

Every scope leaves out thinking and exploration calls (`read`, `grep`, `find`, `ls`): they are how
the agent looked something up, not what it did. Tool arguments travel as JSON and results as stored,
so a reader can reopen the work in a new session or keep it in a document. No scope guesses which
failure was a typo; the conversation scope is how a reader leaves execution noise behind.

A scope copies immediately and closes; a clipboard failure stays in the dialog with its reason and a
retry. Escape, the backdrop and the close button leave the turn unchanged, and focus returns to the
entry.

## Files attached to a prompt

A file dropped onto the chat, or picked with the composer's attach button, is copied into the
working directory without replacing anything already there, and then shown as a chip beside the
composer — the same row images use. The chip carries an icon chosen by extension (a PDF, a Word
document, the language of a code file, and a plain page for anything unrecognized), the file name,
and a remove button; it is announced as an attached file and its tooltip keeps the relative path.
Removing a chip only drops the reference: the copied file stays in the working directory. `@` typed
in the draft, the file tree's reference button, and line references keep inserting text, because
they belong to a sentence.

The chips are not text, but the prompt is unchanged: a send appends the `@path` mentions the chips
stand for, in chip order and quoted when the path contains spaces, so the agent sees exactly what
dropping a file used to type. A file already attached is not attached twice. Chips belong to the
draft, so parking or rekeying a session keeps them; a submission the agent rejects comes back as the
text it was, its mentions written out again.

## Tool presets in the composer

The composer's tool menu lists the built-in presets first, then the user's custom ones, each named
with its tool count, and ends with a single entry that opens Settings at the Tools section. The
control stays visible while a run is in progress — showing which preset the turn uses — but is
disabled so the preset cannot be switched mid-run. The section lists the built-in presets read-only
above the user's own, so the list doubles as a reference, and shows an editor for the selected
custom one: a name, the built-in combinations to start from, and one checkbox per built-in coding
tool. The draft stays local until Save replaces the whole list; Delete is a two-step button kept
apart from Save. Deleting a preset keeps the sessions pinned to its tools and resolves their label
to the configured defaults once the composer reloads its copy.

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

## The composer hub

The composer footer keeps the controls that shape the next message: attach, the model, the reasoning
level and the tool preset. Two controls act on the session instead of one prompt — the goal the
agent keeps working toward, and compaction of the context — and they share one entry. Neither is a
per-turn knob, so neither earns a permanent slot beside the knobs; the mobile footer already hid
compaction behind an overflow while the desktop footer showed it always.

The entry reads **More** and opens one small dialog with two cards, **Compact** and **Goal**, in
the shape the sidebar's **New** dialog uses: cards are the only strong element, and the chrome around
them stays flat. When a goal exists the same entry reads **Goal** and carries the goal's state word,
because a goal that keeps working without the user is the one state that must be readable without
opening anything. On phones the entry is its icon alone, with that state in its accessible name, and
the footer's own expander is named **Controls** so the two never read as one. The dialog's title and
its two cards name the subjects rather than inventing a collective noun, so nothing here competes
with the agent's tools, the tool presets, or the toolbar's Tools panel.

Compaction is one action, so its card acts at once and closes the dialog: it states the session's
context size (`64% of 200k`) and the last compaction's result, then reports in the run status row
above the composer. The card is disabled while a run holds the session, and reads **Stop
compaction** while a compaction is running. A goal is written rather than toggled, so its card opens
a second step holding the whole goal; a **Back** button returns to the choices, and Escape leaves one
level at a time — the goal first, the dialog second. With nothing to compact, the entry opens the
goal directly, because a single card would only repeat the entry.

## Autonomous goals

A goal is one entry in the composer footer, beside the model picker: it reads **Goal** and carries
its state word (**Running**, **Paused**, **Done**, **Blocked**), so the state never rests on color
alone. Only a running goal takes the accent, which marks the one case where the agent keeps working
without the user. There is no separate goal panel or dashboard.

The entry opens the composer hub; its **Goal** card opens the step that holds the whole goal: what
should be achieved, the status, the depth, and the continuations used so far. A new goal starts from
an empty objective at the stored default depth; an existing one shows its state, its stop reason,
and the depth it runs at. Depth is three numbers (automatic turns, tokens, minutes) with **Light**, **Standard**, and
**Deep** shortcuts above them; typing numbers is the custom case, and the line under the fields
states what the run will actually be allowed, including that limits are checked between runs. The
primary action names the change it will make (**Start goal**, **Resume goal**, **Pause goal**,
**Mark finished**, **Save objective**, **Save depth**) and stays disabled when nothing would change.
A depth-only edit never starts a run. A running goal keeps its objective and depth: the field
explains that the goal must be paused, and the dialog offers **Stop run** instead of editing. While
a run is active the status choices are disabled and the dialog says so. The hub traps focus, and the
backdrop or the close button leaves it; the objective field validates on blur with its error beside
the field. Goal completion is the agent's report, not an independent guarantee.

Settings › Goal holds the default depth a new goal starts at, in the same three fields, with
**Restore defaults** beside **Save**. It is one global answer to how far an unattended run may go,
while the dialog still lets a single goal go further or stop sooner.

## Starting a conversation

The sidebar has one entry point for beginning a conversation, the **New** button in its header:
**New** opens a dialog with two large choices, **Add a project** and **Start without a project**;
the footer offers no second "open another project" link.

**Add a project** turns the same dialog into its folder step: the directory browser, with a **Back**
link to the two choices and no "default location" shortcut of its own. Folder rows navigate, while
**Open this folder** commits the location displayed in the footer. The chosen folder starts the
conversation and stays the remembered custom path. Path input suggests matching folders and
automatically displays an existing directory's children; arrow keys and Tab accept a suggestion.
Home navigates to the server user's home directory, and `~` paths are supported. Loading, incomplete
paths and failed navigation disable the commit. A local name filter narrows the displayed folders.
New folders are created inline and browsed before selection, without a second modal. The dialog
contains keyboard focus, restores its opener, and handles Escape locally (closing an unfinished
new-folder form first). Errors stay visible and failed navigation offers Retry. The layout keeps the
destination and action buttons outside the scrolling directory list, including on phones.

**Start without a project** creates today's scratch folder (`~/pi-cwd/YYYYMMDD`) through the
default-directory and validation APIs and starts the conversation there at once; a scratch pick does
not overwrite the remembered custom path. The same two actions stay in the composer's project menu
for a conversation already open, worded as **Add a project…** and **Start without a project**.

## Navigation and accessibility

The conversation directory uses a lightweight overlay entry point rather than a permanent column.
Keep it available even when history fits without scrolling. Its entry point is derived from the
transcript, so it stays visible on desktop widths whenever the conversation has a turn; never let a
layout measurement or a transient mount gate decide whether it exists. Phones keep the chat at full
width and hide the rail. Do not add workspace tabs or agent management panels.

Check desktop, narrow desktop, and phone layouts. Preserve predictable return, close, cancel, and
focus behavior. Do not add modes when simpler interaction suffices.
