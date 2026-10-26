# Integration and Cleanup Plan

This plan tracks the remaining implementation work. The initial integration pass is complete; broader product-surface and dead-code cleanup remains.

## Completed: integrate project-specific presentation

- Renamed tool activity, tool-card expansion, syntax-language, and syntax-token modules to describe their responsibilities.
- Merged the radius, typography, and workspace styles into `app/workspace.css`; tool-card behavior is in `app/tool-cards.css`.
- Moved shell-tool detection into shared `lib/tool-names.ts`.
- Removed project-fork markers and preserved genuine session-fork behavior.
- Updated package metadata for this repository and removed source-project release checks and updater commands. Attribution and licenses remain.

## Remaining: simplify the product surface

Review settings, authentication/provider setup, models, plugins, skills, MCP, and subagent management individually. Retain only what materially helps everyday conversation; prefer existing Pi configuration over duplicate management UI.

Do not remove the underlying agent capability merely because its management panel is unnecessary. Keep essential model selection, execution controls, errors, and useful conversation information. Avoid replacing removed panels with another general-purpose manager.

## 2. Remove obsolete implementation

- Audit the shared files endpoint; retain operations needed for attachments, uploads, inline media, and references. Remove unused browsing, metadata, watch, and linked-directory branches only after checking consumers and preserving authorization.
- Simplify Git project identity and deleted-worktree fallback without breaking session grouping, pins, archives, directory selection, or model resolution.
- Remove unused worktree mutation helpers and legacy context fields.
- Delete unused file/tree/table helpers, panel geometry, terminal font helpers, browser-storage utilities, styles, translations, tests, and dependencies.
- Remove unreachable main-chat thinking renderers and obsolete expansion preferences without losing raw reasoning in full history and exports.

## Verification for code changes

- Open existing sessions and create new ones in selected directories; preserve drafts.
- Exercise session search, rename, pin, archive, restore, fork, and deletion while these remain available.
- Send text and attachments, paste/drop images, use file references, stop execution, and inspect streamed output and errors.
- Check full history and exports against visual transcript filtering.
- Check toolbar information, subagent navigation, Escape, and focus restoration.
- Check desktop and phone layouts, themes, keyboard interaction, and reduced motion.
- Reload with legacy browser preferences; removed workspaces must not return or request retired APIs.
- Run relevant unit, type, lint, browser, and packaging checks. Update stale tests rather than treating them as product requirements.
