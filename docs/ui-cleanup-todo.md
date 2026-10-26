# Conversation workspace cleanup

The current UI retains session management, conversations, agent tool output, the
top toolbar, and an optional information sidebar. File browsing, file previews,
Git controls, worktree management, terminal tabs, and the static demo are removed.

## Deferred cleanup

- Split the shared files endpoint into the operations needed by chat attachments,
  inline images, uploads, and file references. Remove unused listing, metadata,
  download, linked-directory approval, and watch branches only after auditing
  consumers and preserving the existing path and origin checks.
- Simplify Git project identity and deleted-worktree fallback independently of
  session grouping. Existing sessions must retain their project keys, pins,
  archive state, directory selection, and model resolution.
- Remove unused worktree mutation helpers and the remaining legacy worktree
  fields in the new-session context types. No UI calls worktree operation APIs.
- Remove unused file/tree/table helpers, retired panel geometry, terminal font
  helpers, browser-storage utilities, CSS selectors, and translation keys.
- Reconcile historical architecture notes and localized README files with the
  current English README; the frozen upstream inventory in AGENTS.md is historical.

## Manual acceptance

No additional automated checks or browser runs are requested for this change.

- Open existing conversations and create new ones in a selected directory;
  check draft preservation when changing projects and directories.
- Exercise rename, pin, archive, restore, search, Fork, and deletion in the sidebar.
- Send text and attachments, paste/drop images, use file mentions, stop a run,
  and inspect streamed tool calls, command output, and code/patch highlighting.
- Open system prompt, tools, statistics, agents, and conversation branches from
  the toolbar. Close with the button and Escape, and check focus restoration.
- Check wide desktop, narrow desktop, and phone layouts. The information sidebar
  uses 400px when space permits, overlays otherwise, and fills phone widths.
- Select a subagent in the information list or a tool result; its conversation
  opens centrally. Check switching back to its parent conversation.
- Reload with old file/terminal preferences saved in browser storage. No file
  workspace or terminal should return, and no removed API should be requested.

## Transient activity follow-up

- Remove the unreachable main-chat thinking renderer, deferred-content cache and
  old thinking-expansion preference helpers once their remaining direct test
  references are retired. Full-history exports must continue to preserve raw
  reasoning and read calls/results.
- Remove unused reasoning preference and activity-group translations.
