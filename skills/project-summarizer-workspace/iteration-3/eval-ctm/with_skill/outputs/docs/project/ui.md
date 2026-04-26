# UI

## Stack

- **Framework:** React 19.2 (`ui/package.json` deps).
- **Build tool:** Vite 7 (`ui/vite.config.ts`). Tailwind via `@tailwindcss/vite` plugin (Tailwind 4).
- **Styling:** Tailwind 4 + shadcn-style primitives under `ui/src/components/ui/` (config in `ui/components.json`). Radix UI for dialog/slot/tabs primitives. `class-variance-authority` + `tailwind-merge` for variants. `tw-animate-css` for motion. Typography fonts: Inter, JetBrains Mono, Playfair Display from `@fontsource/*` (latin-only subsets — `b30c09b` perf commit dropped Cyrillic/Greek/Vietnamese).
- **State management:** TanStack Query 5 for server state (`staleTime: 30_000`, `refetchOnWindowFocus: false`, retries except on `UnauthorizedError`). Local component state for ephemeral UI. `AuthProvider`, `SseProvider`, `ThemeProvider` are in-tree React contexts. No Redux/Zustand.
- **Routing:** `react-router` 7. `createBrowserRouter` in `ui/src/App.tsx:30`. Routes:
  - `/`, `/s/:name`, `/s/:name/checkpoints`, `/s/:name/pane`, `/s/:name/subagents`, `/s/:name/teams`, `/s/:name/meta` — all resolve to `<Dashboard>` (responsive two-pane).
  - `/feed` → `<FeedFullscreen>`
  - `/doctor` → `<DoctorPanel>`
  - `*` → `<Navigate to="/" replace />`
- **Data fetching:** TanStack Query for `/api/*`. Custom SSE wiring (`@microsoft/fetch-event-source`) for `/events/*`. Per-endpoint hooks under `ui/src/hooks/` map 1:1 to handler families (e.g. `useSessions`, `useFeed`, `useCheckpoints`, `useCost`, `useDoctor`, `useQuota`, `useTeams`, `useSubagents`, `usePaneStream`, `useToolCallDetail`, `useSendInput`, `useCreateSession`).

## Entry & layout

- **Entry file:** `ui/src/main.tsx` — `createRoot(...).render(<App />)` inside `<StrictMode>`.
- **Root layout / shell:** `ui/src/App.tsx` — see provider stack below.
- **Provider stack** (order matters; outer first):
  1. `<ThemeProvider>` (`ui/src/hooks/useTheme.tsx`) — dark/light + `prefers-color-scheme`
  2. `<QueryClientProvider client={queryClient}>` — TanStack Query
  3. `<AuthProvider>` — auth status + login/logout
  4. `<SseProvider>` — single shared EventSource
  5. `<AuthGate>` — gate render until auth status known; renders `LoginForm` / `SignupForm` / app
  6. `<ConnectionBanner>` + `<RouterProvider router={router} />`

## Component organization

- **Type folders, not feature folders.** `routes/` for page-level (10 files), `components/` for reusable (40+), `hooks/` for query+SSE wrappers (~25), `lib/` for plain utils.
- **Naming:** `PascalCase.tsx` for components/routes, `useCamelCase.ts` for hooks, `kebab-case.css` not used (everything is Tailwind).
- **Test colocation:** `*.test.tsx` next to source (Vitest + React Testing Library). E2E lives separately in `ui/e2e/*.spec.ts` (Playwright).
- **Shared primitives:** `ui/src/components/ui/` is the shadcn-style sink (button, dialog, etc.) — verify via `ls`. Feature components import from `@/components/ui/...` via the Vite alias `@ → src/`.

## Design system

- **Tokens:** Tailwind 4 utility classes + CSS variables in `ui/src/index.css` `[inferred]` (file presence verified; contents not read).
- **Primitives:** `ui/src/components/ui/` (shadcn). `ui/components.json` configures style/aliases.
- **Theming:** `useTheme` hook + `ThemeToggle` component in `ui/src/components/ThemeToggle.tsx`. Honors `prefers-color-scheme` `[inferred]` from filename — verify `useTheme.tsx`.
- **Iconography:** `lucide-react`.

## Forms & validation

- **Login/signup:** `LoginForm.tsx` / `SignupForm.tsx` under `routes/`. No form library — plain controlled inputs with inline 401/404/409 handling. Validation is server-side (`/api/auth/*`).
- **Mobile-input gotcha:** `d9e3b0a fix(ui): bump mobile input font to 16px to prevent iOS zoom-on-focus`. Don't drop input font below 16px on mobile.

## i18n / a11y / theming

- **i18n:** None. English-only strings inline.
- **a11y:** Radix primitives provide accessible base. ESLint rules `eslint-plugin-react-hooks` / `react-refresh` enforced. No explicit a11y test suite.
- **Dark mode:** `useTheme` + system-preference fallback `[inferred]`.

## Performance notes

- **Single Dashboard route, responsive layout** — list never unmounts when navigating between `/s/:name/*` sub-routes (App.tsx comment block, 16 lines). Don't introduce per-route components for these — it would break the "list never unmounts" invariant.
- **Two-pane breakpoint at 768px** — Dashboard hides right pane on mobile; selecting a session hides the list. Spec ref: `2026-04-20-ctm-serve-ui-v0.1-design.md` §3.
- **TanStack Query 30s staleTime** — global; bump per-query if you add a hot-loop endpoint.
- **Removed in recent commits:** Cmd+K palette (`ea93aa9 refactor(ui): remove Cmd+K search palette`) and paste-token screen (`5d8dc61`). Don't reintroduce without checking.

## Testing

- **Unit (Vitest):** `*.test.tsx` colocated. `ui/vitest.config.ts` (jsdom, msw for fetch mocking).
- **E2E (Playwright):** 18 specs in `ui/e2e/`. Run via vite preview; mock `/api` + `/events` at page level (no daemon needed). Setup: `pnpm --prefix ui exec playwright install chromium` once, then `make e2e`.
- **Coverage gaps:** No visual-regression suite. No accessibility audit suite.

## Auth flow (V27)

1. App boots → `AuthProvider` calls `useAuthStatus` (`GET /api/auth/status`).
2. `AuthGate` reads status: `unconfigured` → `<SignupForm>`, `unauthenticated` → `<LoginForm>`, `authenticated` → app.
3. Login posts email + password; success sets cookie; provider transitions without page reload.
4. Logout posts to `/api/auth/logout`, drops cookie, transitions to `<LoginForm>` without reload.
5. 401 from any query throws `UnauthorizedError`; QueryClient retry policy bails; provider redirects.

Sources: `ui/src/components/AuthProvider.tsx`, `ui/src/routes/AuthGate.tsx`, `ui/src/routes/LoginForm.tsx`, `ui/src/routes/SignupForm.tsx`, `ui/src/hooks/{useAuthStatus,useLogin,useLogout,useSignup}.ts`. Server side: `internal/serve/api/auth.go` (241 LOC) + `internal/serve/auth/`.

## Vite proxy & SSE

`ui/vite.config.ts` proxies `/api`, `/healthz`, `/health`, `/events` → `http://127.0.0.1:37778` for `pnpm dev`. SSE proxying needs `ws: false` and no buffering (default Vite http-proxy passes streaming through). Don't enable gzip on `/events`.
