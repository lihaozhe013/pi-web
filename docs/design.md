# Interface Principles

## Conversation is the workspace

The interface should feel like a carefully organized agent conversation, not a developer dashboard. Keep frequent actions nearby and reveal secondary information on demand.

The current layout uses a session sidebar, a central conversation and composer, and an optional information sidebar opened from the toolbar. Project groups help locate conversations; they are not project management. A new session chooses a directory, and an existing worktree is simply another directory.

The information sidebar is currently 400px wide. It overlays the conversation when space is limited and fills phone widths. Close and Escape restore focus to the trigger; modal overlays contain keyboard focus.

## Quiet, clear, polished

- Use soft surfaces, restrained corners, and useful whitespace rather than many borders.
- Prioritize readable conversation text; the current default baseline is 16px.
- Use semantic theme variables instead of building another hard-coded skin.
- Do not communicate state through color alone. Keep keyboard focus visible.
- Animate only to explain changes and honor reduced-motion preferences.
- Prefer a good default over unnecessary appearance settings.

## Execution feedback

Show what the agent is doing, whether it finished, and what went wrong without filling the conversation with every low-level event.

Current main-transcript behavior:

- Thinking and explicit read calls use transient status rather than persistent cards.
- Shell cards expand during execution and leave the main transcript after success. Failures retain an inspectable error summary.
- Write/edit cards default to expanded. Patch cards expand during execution and fold after completion.
- Long shell output initially shows its last 16 lines, with access to all output.
- Explicit expansion choices override defaults for retained cards.
- Errors, truncation notices, and necessary warnings remain visible.

Visual filtering must not remove full history, export content, persisted data, or agent context. Distinguish provider waiting, thinking, reading, execution, and compaction. Clear transient status when a run ends. Partial output is not success.

Load syntax highlighting on demand. Unknown languages and streaming input must remain readable without it. Distinguish tool cards with subtle surface tint rather than loud frames.

## Navigation and accessibility

The conversation directory uses a lightweight overlay entry point rather than a permanent column. Keep it available even when history fits without scrolling. Open subagent conversations centrally instead of adding workspace tabs.

Check desktop, narrow desktop, and phone layouts. Preserve predictable return, close, cancel, and focus behavior. Do not add modes when simpler interaction suffices.
