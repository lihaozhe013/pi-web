# Local Browser Tests

Browser regression tests run locally with Playwright. There is no CI workflow.

```sh
bun install --frozen-lockfile
bunx --no-install playwright install chromium
bun run test:e2e
```

The runner starts its own Turbopack server on an available loopback port. Use a checkout without an
active development server: Next.js shares `.next/dev/lock` within a checkout.

Fixtures use a temporary `PI_CODING_AGENT_DIR` and are removed afterward. The suite does not require
model credentials or existing personal sessions. Project navigation fixtures use ordinary
directories.

Tests cover areas such as session pagination, branching, navigation, transcript rendering,
appearance, model selection, and extension dialogs. Appearance coverage includes separate
UI/chat/mono sizes, live preview, reset isolation, multilingual settings search and keyboard result
navigation. Some scripts still reflect removed UI; audit and update those assertions as cleanup
proceeds. Test code is not a commitment to restore obsolete product features.

Run `node e2e/conversation-scope.mjs` for isolated conversation-boundary checks without an app
server. It bundles the current settings and new-conversation components and checks that agent
management is absent, Global AGENTS.md remains editable, and Escape restores focus without losing a
draft on desktop and phone widths. Requests use fixtures, not personal configuration.

Run `node e2e/ask-user.mjs` for isolated question-panel browser coverage without starting a server
or accessing personal sessions. It bundles the real React component with Bun in a temporary
directory and checks choices, free-form answers, collapse, failed-send retry, focus and draft
preservation, skip, three viewport widths, and light/dark themes. Screenshots use the same
`test-results/e2e/` directory. Runtime request metadata, replay, cancellation, and tool results are
covered separately by `lib/ask-user.integration.test.mjs`.

Run `node e2e/directory-picker.mjs` for isolated project-directory dialog coverage without a server
or personal sessions. It exercises the real component with a mocked filesystem: browsing versus
selection, the one-click default action and failures, local filtering, inline creation, keyboard
focus and Escape, draft preservation, and light/dark layouts at desktop, tablet, phone and landscape
sizes. It does not exercise the live filesystem or the sidebar's validation API integration.

Live provider prompts and real agent execution require separate validation. Native phone keyboards
also need real-device testing.

Failures save screenshots, traces, and server logs under `test-results/e2e/`. Inspect a trace with:

```sh
bunx --no-install playwright show-trace test-results/e2e/trace.zip
```

`E2E_SERVER_MODE=start` runs against a production build. Use an isolated checkout for that mode;
never create production output in an active development directory.
