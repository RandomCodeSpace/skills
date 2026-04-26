# UI

The `ui/` directory is the React SPA served by `ctm serve` at `/`. It is **app mode** (the project ships an app users interact with, not a UI library).

## Stack

- **Framework:** React 19.2.5 (`ui/package.json`).
- **Build tool:** Vite 7.0 with `@vitejs/plugin-react` and `@tailwindcss/vite` plugin.
- **Styling:** TailwindCSS v4 (CSS-first config — no `tailwind.config.js`; the v4 plugin reads `@theme` from CSS) + tw-animate-css. Component primitives via shadcn/ui (`ui/components.json`) using Radix UI under the hood (`@radix-ui/react-dialog`, `react-slot`, `react-tabs`, `radix-ui` umbrella).
- **State management:**
  - Server state — TanStack Query 5.99.2 (`@tanstack/react-query`). One `QueryClient` instantiated in `App.tsx` with `staleTime: 30_000`, `refetchOnWindowFocus: false`, retry-2-then-bail. Auth errors short-circuit retry.
  - Client state — local component state + a few React Contexts (`ThemeProvider`, `AuthProvider`, `SseProvider`).
- **Routing:** `react-router` 7.14.1 via `createBrowserRouter`. **All `/`, `/s/:name`, `/s/:name/<tab>` routes resolve to `<Dashboard>`** — the responsive layout reads `useParams()` to swap right-pane content rather than mounting/unmounting. (`ui/src/App.tsx` comments.)
- **Data fetching:** TanStack Query + a custom `api()` helper in `ui/src/lib/api.ts` that injects `Authorization: Bearer <token>` from `localStorage[ctm.token]`. SSE uses `@microsoft/fetch-event-source` (so headers can be sent — native `EventSource` does not allow custom headers).

## Entry & layout

- **Entry file:** `ui/src/main.tsx` (`ReactDOM.createRoot`).
- **Root layout / shell:** `ui/src/App.tsx`.
- **Provider stack** (outer → inner, order matters):
  1. `ThemeProvider` (`@/hooks/useTheme`) — dark/light/system, persists choice.
  2. `QueryClientProvider` — TanStack Query client.
  3. `AuthProvider` (`@/components/AuthProvider`) — owns the bearer token.
  4. `SseProvider` (`@/components/SseProvider`) — opens the long-lived SSE connection to `/events/all` and broadcasts events into TanStack Query cache.
  5. `AuthGate` (`@/routes/AuthGate`) — gates the rest of the app on a present token; falls through to `<LoginForm>` if absent.
  6. `ConnectionBanner` — visible banner when SSE drops.
  7. `RouterProvider` — router + outlets.

## Routes

All routes are declared in `ui/src/App.tsx`:

| Path | Element | Notes |
|---|---|---|
| `/` | `<Dashboard>` | Two-pane on ≥768px (list + auto-selected detail); list-only on <768px. |
| `/s/:name` | `<Dashboard>` | Right pane shows `<SessionDetail>`. |
| `/s/:name/checkpoints` | `<Dashboard>` | Detail tab variant. |
| `/s/:name/pane` | `<Dashboard>` | Detail tab variant — `<PaneView>` (live tmux pane). |
| `/s/:name/subagents` | `<Dashboard>` | Detail tab variant — `<SubagentTree>`. |
| `/s/:name/teams` | `<Dashboard>` | Detail tab variant — `<AgentTeamsPanel>`. |
| `/s/:name/meta` | `<Dashboard>` | Detail tab variant. |
| `/feed` | `<FeedFullscreen>` | Full-screen `<FeedStream>`. |
| `/doctor` | `<DoctorPanel>` | Calls `/api/doctor`. |
| `*` | `<Navigate to="/" replace />` | Catch-all. |

## Component organization

- `ui/src/components/` — Feature components (`SessionCard`, `SessionListPanel`, `SessionDetail`-helpers, `CostChart`, `QuotaStrip`, `FeedStream`, `DiffSheet`, `RevertSheet`, `PaneView`, `SubagentTree`, `AgentTeamsPanel`, `BashOnlyRow`, `ToolCallRow`, `CheckpointRow`, `SessionInputBar`, `NewSessionModal`, `SettingsDrawer`, `ThemeToggle`, `HealthDot`, `LogDiskUsage`, `TokenBreakdown`, `AttentionLabel`, `ToolFrequencySparkline`, `AuthProvider`, `SseProvider`, `ConnectionBanner`).
- `ui/src/components/ui/` — shadcn/ui primitives (`button.tsx`, `card.tsx`, `dialog.tsx`, `sheet.tsx`, `skeleton.tsx`, `tabs.tsx`).
- `ui/src/routes/` — Route-level components (one per top-level URL).
- `ui/src/hooks/` — TanStack Query wrappers (`useSessions`, `useCheckpoints`, `useAttention`, `useAuthStatus`, `useTheme`, `useRecentWorkdirs`, … — the full list lives there).
- `ui/src/lib/` — Pure helpers: `api.ts`, `ansi.ts`, `diff.ts`, `format.ts`, `quota.ts`, `sparkline.ts`, `tools.ts`, `utils.ts`.
- **Naming convention:** `PascalCase.tsx` for components, `camelCase.ts` for libs/hooks. Tests colocated with `.test.tsx` / `.test.ts` suffix.

## Design system

- **Tokens:** TailwindCSS v4 `@theme` block. There's no separate `tokens.json` — Tailwind v4's CSS-first config replaces it. `[inferred from package.json showing tailwindcss v4 + the absence of a tailwind.config.js — verify via `find ui -name 'tailwind.config*'`]`.
- **Primitives:** `ui/src/components/ui/*` (shadcn/ui generated).
- **Fonts:** `@fontsource/inter`, `@fontsource/jetbrains-mono`, `@fontsource/playfair-display` — bundled locally per build.md (no CDN fonts).
- **Documented in:** No Storybook. Visual review is via Playwright screenshots (`ui/test-results/` on failure).

## Forms & validation

Forms are minor surface — login (`ui/src/routes/LoginForm.tsx`), signup (`SignupForm.tsx`), new session (`components/NewSessionModal.tsx`), settings drawer (`SettingsDrawer.tsx`). No `react-hook-form` / `zod` / `formik` dependency. Validation appears to be inline with `useState` + manual checks. `[inferred from absence in `ui/package.json` deps]`.

## i18n / a11y / theming

- **i18n:** None. All strings are inline English. Acceptable per scope (single-developer tool with native-English audience). If RTL/locale support becomes a concern, externalize before more strings accrue.
- **a11y:** Radix UI primitives provide WAI-ARIA out of the box for dialog / tabs / sheet. Custom components rely on semantic HTML. No documented WCAG audit; verify with Playwright + axe before claiming AA. `[inferred — no a11y test harness visible]`.
- **Theming / dark mode:** `@/hooks/useTheme` `ThemeProvider`. Honors `prefers-color-scheme` when no explicit choice. `[inferred — verify via `cat ui/src/hooks/useTheme.ts`]`.

## Performance notes

- **Two-pane mount stability:** Dashboard intentionally stays mounted across `/s/:name` route changes so the session list never re-fetches. (`App.tsx` routing-intent comment.)
- **`h-dvh` over `h-screen`** at the root: tracks the dynamic viewport on mobile so the Live-feed footer doesn't sit below browser chrome. (`Dashboard.tsx` doc comment.)
- **Flex chain `flex-1 min-h-0 overflow-hidden`** in the middle row — `min-h-0` is required for the inner overflow to take effect. (`Dashboard.tsx` doc comment — DON'T REMOVE.)
- **TanStack Query staleTime: 30_000** — refetch only on stale, no refetch-on-focus (mobile-friendly: SSH reconnect doesn't trigger a request storm).
- **SSE replay via `Last-Event-ID`** — `events.Hub.Subscribe` honors the header so a reconnecting client doesn't lose events. The UI's `SseProvider` sets the header from the highest seen event id.

## Dev/E2E quirks

- **Vite proxy** in `ui/vite.config.ts` forwards `/api`, `/events`, `/healthz`, `/health` to `127.0.0.1:37778`. SSE forwards with `ws: false` because SSE is HTTP/1.1, not websockets.
- **`strictPort: true`** on the Vite dev server — port 5173 only.
- **Vitest excludes `e2e/`** (different runner globals; see `ui/vitest.config.ts`).
- **Playwright** runs against `vite preview` (built bundle on port 4173), not dev server. Mocks `/api` + `/events` at `page.route` level, so tests need no daemon. Run `pnpm --prefix ui exec playwright install chromium` once before first run. (`ui/playwright.config.ts`, `Makefile:e2e`.)

## Don't refactor

- `react-router` v7 with `createBrowserRouter` + a single Dashboard handling many `/s/:name/<tab>` routes is intentional. Don't split into per-tab routes; the route-stable mount is load-bearing for the list pane.
- shadcn/ui primitives are *generated into the repo* (`ui/src/components/ui/*`) — not a runtime npm dep. Don't install `@shadcn/ui`; mutate the generated files directly per shadcn convention.
- TailwindCSS v4 has no `tailwind.config.js`. Do not add one; configuration goes in CSS via `@theme`.
- The `dist/` → `internal/serve/dist/` rsync **with `--delete`** is the only canonical embed path. Don't switch to `//go:embed ../../ui/dist` — Go rejects parent-relative embed paths (see `Makefile` comments).
