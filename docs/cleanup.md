# Integration and Cleanup Plan

This is pending work, not a list of completed changes. The documentation rewrite does not rename runtime files or remove application features.

## 1. Remove the project-fork layer

- Inventory `fork-*` components, helpers, styles, imports, tests, and `// fork:` markers.
- Merge useful styles into their owning component or shared design system. Remove redundant overrides rather than merely renaming stylesheets.
- Move useful tool presentation and highlighting behavior into normally named modules. Consolidate duplicate logic and update consumers and tests together.
- Keep genuine session-fork terminology; it describes a user operation, not project ancestry.
- Audit package metadata, repository links, version checks, and updater commands so this independent version does not point users toward source-project releases. Preserve attribution and licenses.

## 2. Reduce product surface

- Review settings, authentication/provider setup, models, plugins, skills, MCP, and subagent management individually. Retain only what materially helps everyday conversation; prefer existing Pi configuration over duplicate management UI.
- Do not remove the underlying agent capability merely because its management panel is unnecessary.
- Keep essential model selection, execution controls, errors, and access to useful conversation information.
- Avoid replacing removed panels with another general-purpose manager.

## 3. Remove obsolete implementation

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
