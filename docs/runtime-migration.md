# Leaving Next.js

Pie serves one React single-page app and a local JSON/SSE API over in-process Pi sessions. Next.js
provides none of that beyond a bundler and a request handler, and it dominates the packaged desktop
size. This document is the plan to replace it with Vite and Hono, keeping the browser app and the
Tauri shell unchanged in appearance and behavior.

Next.js is removed outright. There is no compatibility shell, no `output: 'export'` stopgap, and no
second runtime kept alongside the new one. The migration lands as one change series on `main` and
the final commit deletes `next`, `@next/swc`, `.next`, `next.config.ts`, `proxy.ts`, and `app/`.

## Why

Measured in a checkout with a production build:

| Item                                | Size   |
| ----------------------------------- | ------ |
| `node_modules/next/dist`            | 204 MB |
| `node_modules/@next/swc-<platform>` | 106 MB |
| `.next/server`                      | 71 MB  |
| `.next/static`                      | 11 MB  |
| `@earendil-works/*` (Pi runtime)    | 39 MB  |

Two facts drive the decision:

- `@next/swc` must ship. `packaging/portable.mjs` asserts its presence because Next downloads
  roughly 190 MB of bindings at startup when it is missing. A Rust compiler binary is carried in a
  runtime that already ships the Pi SDK.
- `.next/server` is a second compiled copy of the same client components. Every component is a
  client component with a `'use client'` directive or a transitive import of one; `app/page.tsx` is
  `<Suspense><I18nProvider><AppShell /></I18nProvider></Suspense>`. Nothing is rendered on the
  server, so the SSR build output is pure duplication.

The frontend bundle is about 11 MB of static output, most of it lazy Mermaid and KaTeX chunks. The
application code is not the problem, and it is not what the migration touches.

## Coupling audit

### Frontend: five touch points

| File                             | Usage                          | Replacement                                |
| -------------------------------- | ------------------------------ | ------------------------------------------ |
| `components/AppShell.tsx`        | `useRouter`, `useSearchParams` | local hooks over `location` and `history`  |
| `components/WorkspaceSwitch.tsx` | `next/link`                    | `<a>`                                      |
| `app/login/page.tsx`             | `next/image`                   | `<img>`; optimization is already off       |
| `components/ChatWindow.tsx`      | `next/image`                   | `<img>`                                    |
| `app/layout.tsx`                 | `next/font/google`, metadata   | `@fontsource/noto-sans-mono`, `index.html` |

No component, hook, or `lib` module imports Next otherwise. The 150 components and 42 hooks port
unchanged.

### API: forty-eight route files, about 2,400 lines

Every handler uses `NextResponse.json` and nothing else. There are no redirects built through
`NextResponse`, no `cookies()` from `next/headers`, no server actions, and no route-level data
loading. `lib/json-response.ts` already returns a plain `Response` and already handles gzip; 13
files use it.

Route segment config (`export const dynamic = 'force-dynamic'`) and the `[id]` / `[...path]` folder
conventions are the only other framework surface.

### Server glue

- `proxy.ts` (about 120 lines) is the only middleware: host allow-listing, request-origin checks,
  optional password auth with `Basic` support, failure throttling shared with the login form,
  `/login` redirection with a `next` parameter, and a 128 MB body buffer limit. Its logic lives in
  `lib/request-security.ts`, `lib/web-auth.ts`, and `lib/auth-throttle.ts`; those modules are plain
  functions and move as they are.
- `instrumentation.ts` and `instrumentation-node.ts` provide startup and shutdown hooks.
- `next.config.ts` carries workarounds that disappear with the framework: `proxyClientMaxBodySize`,
  `useTypeScriptCli`, `transpilePackages` for Mermaid, `serverExternalPackages`,
  `allowedDevOrigins`, `images.unoptimized`, and the Turbopack rule for
  `lib/gfm-autolink-email-loader.cjs`.
- Tests use `next/server`'s `NextRequest` in five files; every other route test calls the exported
  handler with a plain `Request`.

## Target stack

```
vite/                  React 19 SPA: index.html, the component tree, Tailwind 4
server/index.ts        Node entry: Hono app, static files, shutdown
server/routes/         one file per former app/api route
server/middleware/     auth, origin, host, body limits
bin/pie.js             unchanged contract: spawn the server, wait, open the browser
```

- **Vite** for the dev server and the production bundle. No server runtime, no second compile, HMR
  instead of Turbopack, and `build.target` follows `browserslist` instead of a per-module
  workaround.
- **Hono with `@hono/node-server`** for the API. Its handler shape `(c) => Response` matches the
  existing handlers, it ships under 1 MB, and it covers path params, wildcards, streaming responses,
  multipart, and static file serving.
- **One Node process** serves `dist/` and `/api/*` on the same loopback port. The web version and
  the desktop version keep the same server, so `src-tauri/src/server.rs` (spawn `bin/pie.js`, probe
  HTTP, guard navigation) needs no change.

Rejected alternatives:

- **Fastify**: `@fastify/multipart` and `@fastify/static` are mature, but they add 2-3 MB and
  plugins for an API whose routes are thin wrappers over `lib/`.
- **Bare `node:http` with a hand-written router**: smallest, but path params, multipart, and
  streaming would be reimplemented for about 1 MB.
- **Next static export plus a separate small API server**: route handlers still need a runtime, so
  the API is rewritten either way while 205 MB of build tooling stays in the tree.
- **Bun as the server**: the Pi runtime and its child processes assume Node; `AGENTS.md` requires
  explicit `node` invocations.

## Work order

Phases are a work order inside one change series, not coexisting runtimes. Each phase ends with a
verification step so a mistake is caught before the next one.

### 1. Server skeleton (0.5 day)

Create `server/app.ts`, `server/index.ts`, and `bin/pie.js` wiring: Hono instance, static file
serving for `dist/`, port and host selection reused from the current launcher, graceful shutdown
that calls the same hooks `instrumentation-node.ts` calls today, and the headers that
`next.config.ts` declares today:

- `/` with `Cache-Control: private, no-cache, max-age=0, must-revalidate`
- `/sw.js` with `public, max-age=0, must-revalidate` and `Service-Worker-Allowed: /`
- `/manifest.webmanifest` with `public, max-age=0, must-revalidate`

Verification: the server answers `/api/home` with the same body as the Next build, and shutdown is
still clean when the process receives SIGINT and SIGTERM.

### 2. Route migration (2-3 days)

Move each `app/api/**/route.ts` to `server/routes/`, keeping the handler logic and the `lib/`
imports untouched:

- `NextResponse.json(body, init)` becomes `c.json(body, init)`; handlers that already call
  `jsonResponse(request, body, init)` keep working because Hono exposes a Web `Request` through
  `c.req.raw`.
- `[id]` becomes `c.req.param('id')`, `[...path]` becomes a wildcard route reading the captured
  path. `new URL(req.url).searchParams` becomes `c.req.query()`.
- Delete `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'`.
- Register routes in the same order the folder structure implied, so a static segment still wins
  over a parameter segment: `/api/sessions/delete` before `/api/sessions/[id]`.

Export each handler function separately from the router registration so the existing tests keep
calling handlers directly with a `Request`. Five test files construct `NextRequest`; replace that
with plain `Request` plus a small cookie helper, and drop `jiti` use in the two tests that import
Next through it.

Verification: `node --experimental-strip-types --test "app/api/**/*.test.mjs"` in the current tree
passes against the migrated handlers, plus a manual pass over the streaming endpoints below.

### 3. Middleware and security (0.5-1 day)

Reimplement `proxy.ts` as one Hono middleware applied to `/`, `/login`, and `/api/*`:

- Host and origin validation through the unchanged `lib/request-security.ts`.
- Password auth through `lib/web-auth.ts`: session cookie, `Basic` fallback for API requests, and
  the 429 throttle from `lib/auth-throttle.ts` shared between the login form and `Basic` guesses. A
  successful `Basic` attempt must not reset the counter.
- `/login` redirects: authenticated users go to `/`, unauthenticated page requests go to
  `/login?next=...`, and `/api/web-auth` stays reachable unauthenticated.
- Body limits: the upload route accepts 100 MB requests. Node's server must not buffer the body
  before the route sees it, or uploads fail the way they did under `proxyClientMaxBodySize`. Verify
  with a file at the route's maximum size.

Verification: the existing route tests for `web-auth`, `files` upload, and `cwd` validation, plus a
manual check that a LAN request with a foreign `Host` header is refused.

### 4. Frontend host (1 day)

- Add `vite.config.ts` with the React plugin, `@tailwindcss/vite`, an `/api` dev proxy to the Node
  server, and `build.target` from `browserslist` (`chrome >= 130`).
- Create `index.html` carrying the current `<head>`: `THEME_INIT_SCRIPT`, manifest link, icons,
  `viewport-fit=cover`, `interactiveWidget: resizes-content`, theme colors, `translate="no"`.
- Replace the five Next touch points listed above. `AppShell` needs local equivalents of
  `useSearchParams` and a `replaceState` navigation, because `?mode=tasks` remains part of the app's
  state.
- Move the sixteen CSS imports from `app/layout.tsx` into `src/main.tsx`, keeping KaTeX's stylesheet
  before them.
- Serve the PWA pieces statically: `public/manifest.webmanifest` generated at build time from the
  same fields `app/manifest.ts` returns, `public/sw.js` unchanged, and the offline page untouched.

Verification: `bun run dev` reaches the app with the dev proxy, the existing `e2e/run.mjs` suite
passes against the Vite dev server, and a production bundle boots from the Node server.

### 5. Removal and packaging (0.5 day)

- Delete `next`, `@next/swc`, `.next`, `next.config.ts`, `next-env.d.ts`, `proxy.ts`, `app/`,
  `instrumentation*.ts`, `lib/gfm-autolink-email-loader.cjs`, and the Next entries in
  `tsconfig.json` and `.oxlintrc.json`.
- `package.json` scripts become `dev` (Vite plus the Node server), `build` (Vite plus a server
  typecheck), and `start` (the Node server). `files` lists `dist` and `server` instead of `.next`.
- `packaging/portable.mjs` loses `assertNextSwc`, the `.next` pruning, and the `@next` handling; it
  copies `dist/`, `server/`, and the runtime `node_modules` it already resolves.
- `packaging/desktop.mjs` keeps `DESKTOP_BUILD_ENV`; the flag it sets becomes a build-time Vite
  define rather than a `NEXT_PUBLIC_*` variable. `NEXT_PUBLIC_APP_VERSION`,
  `NEXT_PUBLIC_APP_COMMIT`, `NEXT_PUBLIC_PI_VERSION`, and `NEXT_PUBLIC_PIE_DESKTOP` become
  `import.meta.env` values with the same consumers.
- `e2e/run.mjs` starts the new server; its `E2E_SERVER_MODE` check against `.next/dev/lock`
  disappears.

Verification: `bun run typecheck`, `bun run lint`, `node e2e/run.mjs`, `bun run test:portable`, and
a desktop build from a copy.

## Equivalence checklist

Nothing below may change behavior, and each item gets a check before the Next files are deleted:

1. Session list pagination, `summary=1`, and `no-store` on every API response.
2. Agent event streaming: headers, no buffering, and a closed browser stream releasing the lease.
3. Bash output polling and the bounded tail responses.
4. File reads, inline media, tool-result images, and byte-range or direct responses as they are now.
5. Uploads at 100 MB with conflict strategies, plus the bounded-form-data limits.
6. Path authorization for `cwd`, linked directories, and file references.
7. Password auth: cookie, `Basic`, throttle, `Retry-After`, and the login redirect chain.
8. Host and origin refusal for LAN requests, with the same status codes and bodies.
9. Service worker registration, offline page, and manifest fields.
10. The desktop shell loading the same URL and its navigation guard staying effective.
11. Route tests still calling handlers directly, without a live server.
12. `GET /api/home` and the version strings in Settings › About.

## Expected result

| Item                   | Before    | After      |
| ---------------------- | --------- | ---------- |
| Framework runtime      | 310 MB    | under 2 MB |
| Compiled client copies | 2         | 1          |
| Desktop artifact       | ~100 MB   | ~25-35 MB  |
| Dev server             | Turbopack | Vite       |

The remaining payload is the Pi runtime at about 39 MB plus the SPA bundle.

## Risks

- **`proxy.ts` behavior drift.** The throttle and redirect rules are subtle and security relevant;
  port them line by line and keep the existing unit tests.
- **Request body handling.** A 100 MB upload works today only because the body buffer was raised. In
  Node, a framework that pre-parses `formData()` can reintroduce the truncation.
- **Streaming.** SSE through `@hono/node-server` needs an unbuffered write path and explicit
  no-buffer headers; a proxy is not involved locally, but the desktop shell's custom-scheme guard
  must still let the stream through.
- **Search parameters.** `?mode=tasks` and session deep links are part of the app's state. The
  `AppShell` replacement must read and write history exactly as `useSearchParams` did, including the
  initial history entry.
- **Font loading.** `next/font` self-hosts Noto Sans Mono at build time. A `@fontsource` package or
  a local file must keep the `--font-noto-mono` variable and must not require network access to
  build.

## Verification

Per change, run the single most relevant test file. Before deleting the Next files, run the
equivalence checklist against the new server, then:

```sh
bun run typecheck
bun run lint
node e2e/run.mjs
bun run test:portable
bun run desktop:build
```
