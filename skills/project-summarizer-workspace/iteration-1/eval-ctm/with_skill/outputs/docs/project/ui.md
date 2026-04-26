# UI

## Stack

- **Framework:** React 19.2.5 (`ui/package.json`).
- **Build tool:** Vite 7 (`ui/vite.config.ts`). Build = `tsc -b && vite build` (`ui/package.json:scripts.build`). Output: `ui/dist/`, then `make ui` rsyncs into `internal/serve/dist/` for `//go:embed`.
- **Styling:** Tailwind CSS 4 via `@tailwindcss/vite` 4.2.2 (`ui/vite.config.ts` — `tailwindcss()` plugin). `tw-animate-css` 1.4 for animation utilities. shadcn-style component primitives configured in `ui/components.json` (the Radix wrappers in `ui/src/components/ui/`).
- **State management:**
  - **Server state:** `@tanstack/react-query` v5.99 — single `QueryClient` constructed in `ui/src/App.tsx` with `staleTime: 30_000`, `refetchOnWindowFocus: false`, retry capped at 2 unless `UnauthorizedError` (which short-circuits to redirect via AuthProvider).
  - **Client state:** Local component state + a small set of providers — `ThemeProvider` (`ui/src/hooks/useTheme.tsx`), `AuthProvider` (`ui/src/components/AuthProvider.tsx`), `SseProvider` (`ui/src/components/SseProvider.tsx`). No Redux / Zustand / Pinia.
- **Routing:** `react-router` 7.14.1, declarative `createBrowserRouter` in `ui/src/App.tsx`. Routes:
  - `/` — Dashboard (no session selected)
  - `/s/:name` — Dashboard with session detail
  - `/s/:name/checkpoints` — checkpoints tab
  - `/s/:name/pane` — live pane stream
  - `/s/:name/subagents` — subagents tree
  - `/s/:name/teams` — teams panel
  - `/s/:name/meta` — session meta tab
  - `/feed` — full-screen feed
  - `/doctor` — doctor panel
  - `*` — `<Navigate to="/" replace />`

  All session-detail routes resolve to `<Dashboard />`; the right pane reads `useParams()` and swaps content without unmounting the list. On <768px, the dashboard hides the right pane and uses single-pane navigation (App.tsx routing-intent comment).
- **Data fetching:** React Query for REST; `@microsoft/fetch-event-source` for SSE (`useEventStream.ts`, `SseProvider.tsx`). One hook per server resource — see Hooks list below.

## Entry & layout

- **HTML entry:** `ui/index.html` — Vite mounts to `<div id="root">`.
- **JS entry:** `ui/src/main.tsx`. (Standard `createRoot(document.getElementById("root")).render(<App />)` `[inferred — file present, not read]`.)
- **Root component:** `ui/src/App.tsx` — wires the provider stack and the router.
- **Provider stack (order matters):**
  ```
  ThemeProvider                     // theme (dark default? [inferred])
   └─ QueryClientProvider           // server state cache
       └─ AuthProvider              // login/logout, redirect on UnauthorizedError
           └─ SseProvider           // /events SSE singleton
               └─ AuthGate          // route-level auth guard
                   └─ ConnectionBanner   // offline / reconnecting indicator
                       └─ RouterProvider // react-router
  ```

## Component organization

Two-tier layout under `ui/src/`:

```
ui/src/
├── main.tsx, App.tsx, test-setup.ts
├── lib/                          — utility/data libraries (no JSX)
│   ├── api.ts                    — fetch wrapper (likely UnauthorizedError thrower [inferred])
│   ├── ansi.ts (+ test)          — ANSI escape parsing for the pane stream
│   ├── diff.ts                   — diff helpers used by DiffSheet
│   ├── format.ts, utils.ts       — misc formatters; classnames helper (likely cn() — clsx + tailwind-merge)
│   ├── quota.ts                  — quota / cost arithmetic
│   ├── sparkline.ts (+ test)     — micro-chart helpers
│   └── tools.ts                  — tool-name pretty-printing / categorization
├── hooks/                        — one file per concern; data hooks are React Query wrappers
│   ├── useSessions.ts, useFeed.ts, useFeedHistory.ts, useEventStream.ts,
│   ├── usePaneStream.ts, useSendInput.ts, useCheckpoints.ts,
│   ├── useCost.ts, useQuota.ts, useDoctor.ts, useHealth.ts,
│   ├── useAttention.ts, useSubagents.ts, useTeams.ts,
│   ├── useToolCallDetail.ts, useLogsUsage.ts, useRecentWorkdirs.ts,
│   ├── useCreateSession.ts, useConfigUpdate.ts,
│   ├── useAuthStatus.ts, useLogin.ts, useLogout.ts, useSignup.ts,
│   ├── useTheme.tsx              — context-based theme provider (.tsx because it exports JSX)
│   └── useHotkey.ts (+ test)     — keyboard shortcut binder
├── components/                   — feature components (PascalCase.tsx)
│   ├── SessionCard.tsx, SessionInputBar.tsx, ConnectionBanner.tsx,
│   ├── ToolCallRow.tsx, ToolFrequencySparkline.tsx, CostChart.tsx,
│   ├── PaneView.tsx, DiffSheet.tsx, RevertSheet.tsx,
│   ├── NewSessionModal.tsx, SettingsDrawer.tsx, ThemeToggle.tsx,
│   ├── QuotaStrip.tsx, AttentionLabel.tsx, FeedStream.test.tsx,
│   ├── HealthDot.tsx, LogDiskUsage.tsx, SubagentTree.tsx,
│   ├── AgentTeamsPanel.tsx, AuthProvider.tsx, SseProvider.tsx
│   └── ui/                       — shadcn primitives (lowercase filenames)
│       ├── button.tsx, card.tsx, dialog.tsx, sheet.tsx, skeleton.tsx, tabs.tsx
└── routes/                       — page-level route components (PascalCase.tsx)
    ├── Dashboard.tsx, SessionDetail.tsx, FeedFullscreen.tsx,
    ├── DoctorPanel.tsx, AuthGate.tsx, LoginForm.tsx, SignupForm.tsx
```

Naming conventions:

- Feature components and routes: `PascalCase.tsx`. Tests colocated as `<Component>.test.tsx`.
- shadcn primitives in `components/ui/`: lowercase filenames (`button.tsx` not `Button.tsx`).
- Hooks: `useXxx.ts` (or `.tsx` if they export JSX, e.g. `useTheme.tsx`).
- `lib/` files are camelCase, no JSX, dependency-light.

## Design system

- **Token & primitive system:** shadcn-style — primitives composed from Radix UI under `ui/src/components/ui/` (`button`, `card`, `dialog`, `sheet`, `skeleton`, `tabs`). Configured in `ui/components.json`. Helper: `cn()` from `lib/utils.ts` `[inferred]` combining `clsx` + `tailwind-merge` (both in `package.json`).
- **Tailwind config:** Tailwind 4 with the new plugin-based config (no separate `tailwind.config.ts` visible at root — Tailwind 4 reads from CSS `@theme` blocks `[inferred]`).
- **Fonts (bundled, offline-safe):** `@fontsource/inter`, `@fontsource/jetbrains-mono`, `@fontsource/playfair-display` — all locally vendored via npm. No Google Fonts.
- **Icons:** `lucide-react` 0.544.

## Forms & validation

- No dedicated form library (`react-hook-form` / `formik` / `vee-validate` are not in `package.json`).
- Auth forms (`LoginForm.tsx`, `SignupForm.tsx`) and `NewSessionModal.tsx` use standard React controlled inputs `[inferred from absence of form libs and presence of *.test.tsx coverage on these]`. Validation is server-side via `/api/auth/login` and `/api/sessions` rejection paths (`internal/serve/api/auth.go`, `internal/serve/api/create.go`).

## i18n / a11y / theming

- **i18n:** None — no i18n library in `package.json`. Strings are inline (`[inferred]`).
- **a11y:** Radix primitives provide ARIA semantics by default. ESLint config (`ui/eslint.config.js`) — not inspected; check whether `eslint-plugin-jsx-a11y` is wired (`[inferred — not in package.json devDependencies]`, so no).
- **Theming / dark mode:** `ThemeProvider` in `ui/src/hooks/useTheme.tsx`. Toggle via `ThemeToggle.tsx`. Implementation likely class-based on `<html>` (`dark:` Tailwind utilities) `[inferred]`. Honoring `prefers-color-scheme` is not verified — open `useTheme.tsx` to confirm before claiming compliance.

## Performance notes

- React Query `staleTime: 30_000` keeps refetches at bay (`App.tsx`).
- SSE is centralized in one provider (`SseProvider`) so the app doesn't open multiple `EventSource` connections.
- `SessionInputBar`, `PaneView`, `DiffSheet`, `RevertSheet`, `SubagentTree`, `AgentTeamsPanel`, `FeedStream` all have colocated `.test.tsx` files — modifications must keep existing tests green.
- Live pane stream (`usePaneStream` + `PaneView`) parses ANSI in `lib/ansi.ts`. Long sessions can produce a lot of escape sequences; check `ansi.test.ts` for the expected ceilings before changing the parser.
- The router never unmounts `<Dashboard>` between session changes (App.tsx routing-intent comment) — this means React Query caches survive navigation but it also means heavy state in Dashboard keeps living. Don't put per-session-only refs at the Dashboard level.
- No code-splitting / lazy routes are set up `[inferred — no React.lazy / dynamic import seen in App.tsx]`. The whole SPA is one bundle. For a single-user mobile-attached app this is fine.

## Test layers (UI)

- **Vitest unit tests** — colocated `*.test.ts` / `*.test.tsx` files. Configured in `ui/vitest.config.ts` with jsdom + `ui/src/test-setup.ts`. Run: `pnpm --prefix ui test`.
- **Playwright E2E** — `ui/e2e/` against a built `vite preview` on `127.0.0.1:4173` (`ui/playwright.config.ts`). Mocks `/api` + `/events` via `page.route` so no daemon or fixture DB required. Chromium-only project. Trace on failure, screenshot on failure. Run: `make e2e` (rebuilds first) or `pnpm --prefix ui exec playwright test` (assumes `dist/` is current).
- **MSW** (`msw` in devDependencies) — present but Playwright route mocks supersede in E2E; check `ui/src/test-setup.ts` to see if Vitest tests use MSW handlers.

## Constraints to respect

- **Don't add a new path alias.** Only `@` → `ui/src/` is wired (`vite.config.ts`, `tsconfig.app.json`). New aliases need both files updated and risk breaking the embed step.
- **Don't bypass the React Query layer for server data.** Adding raw `fetch` in components defeats the cache, retry policy, and the `UnauthorizedError` redirect path.
- **Don't open additional `EventSource` connections.** Use `useEventStream` / `SseProvider`. The Vite dev proxy explicitly disables WS/buffering for `/events` (`vite.config.ts`); a second provider would race.
- **Don't add CDN font/icon URLs.** Fonts are bundled via `@fontsource/*`; icons via `lucide-react`. Build must succeed offline (project root rule).
- **Tests are mandatory.** Every shipped fix or feature adds a test (`Makefile` regression contract). Vitest for component logic, Playwright for journey-level verification.
