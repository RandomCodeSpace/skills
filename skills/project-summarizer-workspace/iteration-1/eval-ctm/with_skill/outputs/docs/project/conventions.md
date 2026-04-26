# Conventions

Rules to follow when modifying ctm. Each one cites a representative file. The "why" is included only when it isn't obvious from the rule itself.

## Build / tags

- **Always pass `-tags sqlite_fts5` to `go build` / `go test` / `go install` / `go run`.** Source: `Makefile` header comment + applied to every target. Without it, anything that touches an FTS5 table panics at boot. Use `make build` or `make regression` rather than rolling your own go invocations.
- **No public CDNs.** Fonts come from `@fontsource/*` (vendored via npm). Icons from `lucide-react`. The build must be reproducible offline.
- **UI is built before the Go binary.** Order: `pnpm install` → `pnpm build` → `rsync ui/dist/ → internal/serve/dist/` → `go build`. The `Makefile build:` target enforces this dependency.

## Code style

- **Go formatting:** standard `gofmt` / `goimports` (no `golangci-lint` config in the repo `[inferred from absence of `.golangci.yml`]`). Stick to the existing import grouping (stdlib / third-party / project, blank-line separated).
- **TypeScript strict mode.** `tsconfig.json` has `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`. PRs must pass `pnpm --prefix ui exec tsc --noEmit` (in `make regression`).

## Error handling

- **Wrap with `%w` when bubbling.** Pattern observed throughout (e.g. `cmd/attach.go:80`: `fmt.Errorf("resolving workdir: %w", err)`). Don't shadow with bare `%v` — callers may be sentinel-checking with `errors.Is` (e.g. `serve.ErrAlreadyRunning` in `cmd/serve.go:65`).
- **Sentinel errors live next to their producers.** Example: `serve.ErrAlreadyRunning` is exported from `internal/serve/server.go` and consumed by `cmd/serve.go`. Don't define new ones in `cmd/`.
- **Hooks swallow errors deliberately.** `cmd/hooks_dispatch.go:fireHook` and `fireServeEvent` return nothing. The contract is "best-effort, never block the user". Don't add error returns to these helpers.
- **Daemon non-fatal config load failure.** `cmd/serve.go:43-46` logs a WARN and proceeds with defaults. Match that pattern when adding new daemon-init reads.

## Naming

- **Cobra subcommand files:** one file per command, lowercase Go file name matching the command (`attach.go` → `ctm attach`, `last.go` → `ctm last`). `init()` registers via `rootCmd.AddCommand(...)`. Test file is `<name>_test.go`.
- **API handler files (Go):** one file per resource under `internal/serve/api/` (`sessions.go`, `auth.go`, `feed.go`, `feed_history.go`, …). Tests colocated `<resource>_test.go`. Sub-resource handlers live in the same file as the parent (e.g. checkpoints in `checkpoints.go`, diff in `diff.go`).
- **UI hooks:** `useXxx.ts` (or `.tsx` if they export JSX). One file per server resource or one logical concern.
- **UI components:** `PascalCase.tsx`. shadcn primitives are the exception (lowercase) and live in `components/ui/`.
- **UI tests:** colocated `<Name>.test.tsx` next to the source. Vitest discovers them automatically.

## Tests

- **Where they live:** colocated with the code under test. Go: `<file>_test.go` next to `<file>.go`. UI: `<Component>.test.tsx` next to `<Component>.tsx`.
- **Unit vs. integration:**
  - Go unit/integration: `go test ./...`. The `internal/serve/...` subtree is additionally run with `-race` in `make regression`.
  - Root `integration_test.go` is `//go:build integration` — spawns the compiled `./ctm` binary; CI-skips tmux tests when `$CI` is set (`integration_test.go:65`).
  - UI unit: `vitest` in jsdom (`ui/vitest.config.ts`, `ui/src/test-setup.ts`).
  - UI E2E: Playwright on a `vite preview` build with mocked `/api` + `/events` (`ui/playwright.config.ts`).
- **Single test:** `go test -tags sqlite_fts5 -run TestName ./pkg/path` for Go, `pnpm --prefix ui test <pattern>` for vitest, `pnpm --prefix ui exec playwright test e2e/<file>.spec.ts -g 'name'` for Playwright.
- **PR contract:** every shipped fix or feature adds a test under `unit / vitest / e2e`. The regression pack grows monotonically (`Makefile` `regression:` comment).

## Logging

- **Library:** `log/slog` configured by `internal/logging/Setup(level)`. Default level `info`. Levels: `debug | info | warn | error`. `--log-level` and `--verbose` (alias for `--log-level=debug`) are persistent flags on `rootCmd` (`cmd/root.go`).
- **Channel discipline:** **stderr** for diagnostics (slog), **stdout** for user output (`internal/output.Printer`). Mixing these breaks scripts piping ctm output (`internal/logging/logging.go` package doc).
- **Format toggle:** `CTM_LOG_FORMAT=json` switches to NDJSON. Default is human-readable text. `CTM_LOG_FORMAT` is the single env var read by the logging package.
- **No PII in logs.** No explicit redaction logic — but tool-use payloads (which can contain anything claude saw) go to JSONL files at 0600, not slog. Don't introduce slog calls that log session content.

## Configuration

- **Strict JSON decode.** Use `internal/jsonstrict` (DisallowUnknownFields) when reading state files. Adding a field requires bumping `schema_version` only if old configs would silently lose data; for additive fields with safe zero defaults (the common case), the `Resolved()` accessor pattern handles it without a bump.
- **Defaults via accessors, not literal fallbacks at the call site.** When a numeric field has zero-means-default semantics, expose a `Resolved*()` method and call that — `internal/config/config.go` already does this for `HookTimeout()`, `ServeConfig.ResolvedPort()`, `AttentionThresholds.Resolved()`. Don't sprinkle `if x == 0 { x = 5 }` in handlers.
- **Path helpers are the API.** `config.ConfigPath()`, `config.SessionsPath()`, `config.TmuxConfPath()`, `config.ClaudeOverlayPath()`, `config.EnvFilePath()`, `config.Dir()` (`internal/config/config.go:215-250`). Don't hardcode `~/.config/ctm/...` anywhere else.

## State files

- **Atomic writes only.** Pattern: write to `<path>.tmp`, then `os.Rename`. See `internal/serve/auth/user.go:Save` for the canonical example.
- **Backup before destructive migrate.** The migrator copies original bytes to `<path>.bak.<unix-nano>` before stamping a new schema version (`README.md` "State file versioning").
- **0600 for files containing secrets / personal state.** Already correct for `user.json` (`auth/user.go`) and JSONL logs. `claude-overlay.json` and sessions backups are 0644 today (gap noted in `docs/robustness-audit.md` row 6) — when touching those code paths, opportunistically tighten.
- **Lock files at 0600, log dirs at 0700** (already correct per the audit).

## HTTP & API

- **All `/api/*` routes are auth-gated.** `internal/serve/auth/middleware.go` runs ahead of every API handler. `/healthz`, the root SPA, and `/events` are intentionally exposed (`assets.go:43` SPA fallback excludes `/api/` and `/events/`). Don't add a new `/api/*` handler that bypasses the middleware; if you need an unauth endpoint, register it outside `/api/`.
- **Loopback-only bind.** `127.0.0.1:37778`. Don't change `net.Listen` to `0.0.0.0`. Remote access is intended via SSH port-forwarding only.
- **SSE handlers must drain `<-r.Context().Done()`.** `Server.Shutdown` cancels the request context tree (`server.go` `requestCtx`/`requestCancel`). A handler that ignores it will block `http.Shutdown` past the grace deadline.
- **Single-instance is silent success, not failure.** When `serve.New` returns `ErrAlreadyRunning`, callers must return `nil` from cobra's `RunE` (`cmd/serve.go:65`). Treat it as "another ctm serve is already running here" — a feature, not an error.

## Adding a new ___

### Adding a new CLI subcommand

1. Create `cmd/<name>.go` with a `&cobra.Command{...}` and an `init()` that calls `rootCmd.AddCommand(<name>Cmd)`. Pattern: `cmd/serve.go:18-21`.
2. If the command spawns claude/affects sessions, call `proc.EnsureServeRunning(ctx)` early (pattern: `cmd/attach.go:55`) so the daemon picks up the lifecycle event.
3. At each lifecycle moment, call **both** `fireHook("on_<event>", sess)` and `fireServeEvent("session_<event>" or "on_<event>", sess)` from `cmd/hooks_dispatch.go`. See `cmd/attach.go:97-99`, `cmd/yolo.go:123-124` for examples.
4. Add tests at `cmd/<name>_test.go`.
5. If the command appears in `ctm help` output, the assertions in `integration_test.go:39` may need updating.
6. Update the `Commands` table in `README.md`.

### Adding a new HTTP route

1. Decide the resource bucket. New resource → new `internal/serve/api/<resource>.go`. Existing resource → add to its file.
2. Define handler `func (s *Server) handleX(w, r)` `[inferred — verify by reading an existing handler like internal/serve/api/sessions.go]`.
3. Wire the route in `internal/serve/server.go` (the route table is in this file — search for the existing path strings like `/api/sessions`).
4. The route is auth-gated automatically because the middleware wraps `/api/*`.
5. Define request/response types in the same file (no separate `types.go` convention observed).
6. Add `<resource>_test.go` with `httptest.NewRequest(...)` test cases. Pattern: `internal/serve/api/sessions_test.go`.

### Adding a new UI hook

1. Create `ui/src/hooks/use<Name>.ts`.
2. Wrap a React Query call: `useQuery({ queryKey: [...], queryFn: () => api.<thing>() })`. Use `lib/api.ts` for the actual fetch — it sets the auth cookie and throws `UnauthorizedError` on 401, which `App.tsx` handles globally.
3. For mutations: `useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries(...) })`.
4. Add tests if the hook has non-trivial logic (most existing hooks don't have direct tests; their components do — see `useFeedHistory.ts` vs `FeedStream.test.tsx`).

### Adding a new lifecycle hook event

1. Pick a name (`on_<verb>`, e.g. `on_rename`).
2. At every CLI call site, fire both shell hook + serve event:
   ```go
   fireHook("on_rename", sess)
   fireServeEvent("session_renamed", sess)
   ```
3. Document the event name and `CTM_SESSION_*` env vars passed (see `cmd/hooks_dispatch.go:38-53`).
4. The web UI side: nothing — the hub already broadcasts whatever `/api/hooks/:event` accepts. UI consumers subscribe via SSE.
5. Update README's overlay section if the event has visible UX.

## Things to avoid

- **Don't introduce a non-FTS5 SQLite path.** Everything assumes the build tag is on; mixing tags means `go test ./internal/serve/store/` could pass without the FTS5 store and ship broken.
- **Don't open additional listeners.** ctm is a single-binary, single-port project. Adding a second listener (debug pprof, metrics) needs explicit user opt-in via config and must default off.
- **Don't add `unsafe.Pointer` or `cgo` outside the existing `mattn/go-sqlite3` dep.** It's the only cgo path; keeping the binary statically linkable is part of the "single binary" promise.
- **Don't fork `internal/serve/proc.EnsureServeRunning`.** If you need the daemon up, call this. Multiple spawn paths will race on the bind.
- **Don't bypass `internal/output.Printer` for user-facing CLI output.** stdout vs stderr discipline matters (see Logging).
- **Don't add a runtime call to the public internet** (e.g. version-check, telemetry, font CDN). The build/runtime must work offline.
- **Don't break Linux-only assumptions silently.** `internal/claude/process.go` parses `/proc`. If you add a feature that needs a process listing, gate it on Linux explicitly or extend `process.go` with a darwin/BSD branch — see `docs/robustness-audit.md` row 3.

## Things to revisit (open issues from the audit)

`docs/robustness-audit.md` (2026-04-18) lists known gaps. The most relevant for an agent making changes:

- **#4** Overlay JSON: no `DisallowUnknownFields`. Be careful when refactoring the overlay loader.
- **#6** `claude-overlay.json` + sessions backup files at 0644; should be 0600.
- **#9** Releases unsigned; no SBOM, no checksums beyond `SHA256SUMS`.
- **#10** No structured logging fields convention (slog is set up but field names are ad-hoc).
- **#16/#17** `schema_version` migration coverage is partial.
- **#19** Lifecycle hooks are partially implemented — `on_attach`/`on_yolo`/`on_kill` present, but `on_new`/`on_safe` recently added.

If your change touches one of these areas, opportunistically file the gap rather than silently working around it.
