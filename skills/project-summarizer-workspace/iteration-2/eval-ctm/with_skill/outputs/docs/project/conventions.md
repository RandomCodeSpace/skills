# Conventions

Rules to follow when modifying this code. Each item: the rule, an example file, and the *why* if it's non-obvious.

## Code style

- Standard `gofmt` + `goimports`. No custom linter ruleset declared (no `.golangci.yml`). `[inferred — verify via `ls .golangci*`]`.
- TypeScript: `tsc --noEmit` + `eslint .` (config in `ui/eslint.config.js`). React 19's automatic JSX runtime — no manual `import React` for JSX.
- Comments are dense and *purpose-explaining*, not API-restating. Match the existing style: short paragraph above non-trivial functions explaining *why*, not *what*. (See `internal/migrate/migrate.go` package doc, `cmd/yolo.go:shouldResumeExisting` doc, `internal/claude/command.go:BuildCommand` doc.)

## Error handling

- Plain `error`. Wrapping with `fmt.Errorf("...: %w", err)` is the norm (see `internal/session/spawn.go`).
- **Errors that should not block user flow are explicitly swallowed** at the call site, with a comment naming the policy. Examples:
  - `cmd/hooks_dispatch.go:fireHook` — hook errors must never block the action.
  - `cmd/yolo.go:gitCheckpoint` — `exec.Command(...).Run() //nolint:errcheck` for the checkpoint commit; rationale in surrounding code.
  - `cmd/bootstrap.go:ensureSetup` — overlay sidecar / alias / log-prune errors silently ignored. Comment: "must never block launching claude on a well-configured host."
  - `internal/serve/proc.PostEvent` — failure swallowed because the daemon being down must never block the CLI.
- **Don't** swallow errors silently elsewhere — match the explicit pattern with a comment.
- CLI commands return `error` from `RunE`; cobra prints + non-zero exits. Use `cobra.SilenceUsage` and `SilenceErrors` for hidden subcommands (`cmd/statusline.go`, `cmd/log_tool_use.go`).

## Naming

- **Files:** `cmd/<verb>.go` for cobra subcommands; `cmd/<verb>_test.go` for tests. `internal/<pkg>/<thing>.go` for one type per file when sensible.
- **Packages:** short, lowercased, no underscores (`ingest`, `attention`, `webhook`).
- **Tests:** `_test.go` colocated with the file under test. Property tests get the `_property_test.go` suffix (`internal/session/state_property_test.go`).
- **Hidden cobra commands** (statusline, log-tool-use): set `Hidden: true` + `SilenceUsage: true` + `SilenceErrors: true`.
- **Test seams:** narrow interfaces declared next to the consumer (`internal/session/spawn.go`'s `TmuxSpawner` and `Saver`). Don't promote test-seam interfaces to a shared package.

## Tests

- **Unit tests** colocate with source. Run via `go test -tags sqlite_fts5 ./...`.
- **Race tests** are scoped to the daemon: `go test -race -tags sqlite_fts5 ./internal/serve/...` (daemon has goroutines; CLI mostly doesn't).
- **Integration tests** live at the repo root: `integration_test.go` declares `//go:build integration`. Run via `go test -tags integration ./...` against a built `./ctm` binary; each test gets its own `t.TempDir()` as `$HOME`.
- **Vitest** for UI unit tests. Excluded paths: `node_modules`, `dist`, `e2e/**`. Runs via `pnpm --prefix ui test`.
- **Playwright** for E2E. Mocks `/api`+`/events` at `page.route` level — no live daemon needed. Built bundle (vite preview), not dev server, for prod-like CSS.
- **Single test:** `go test -tags sqlite_fts5 ./internal/tmux/ -run TestSendKeys -v`.
- **Test fixtures** for sessions use `fakeTmux` / `fakeStore` types defined in the `*_test.go` files — narrow stubs, not a fixture framework.

## Logging

- `log/slog` only. Use the package logger; never `log.Printf` or `fmt.Fprintln(os.Stderr, ...)`. Configured by `internal/logging.Setup(level)` from `cmd/root.go:PersistentPreRunE`.
- Levels: `debug` (verbose flow), `info` (default; lifecycle events), `warn` (recoverable failures, swallowed errors), `error` (real failure surfacing to the user).
- Format toggle: `CTM_LOG_FORMAT=json` produces NDJSON. Default is text.
- Add structured fields rather than formatting into the message: `slog.Warn("could not kill", "session", name, "err", err)` not `slog.Warn(fmt.Sprintf("could not kill %s: %v", name, err))`.
- The `internal/output` package is for **user-facing** colored output on stdout/stderr (used in CLI commands like `doctor`). Don't mix it with `slog` (which writes to stderr unconditionally for diagnostics).

## Adding a new HTTP route

1. Decide the resource family. Either find an existing file in `internal/serve/api/<resource>.go` or create a new one.
2. Define the handler **factory function** that returns `http.HandlerFunc` and accepts its dependencies via narrow interface parameters declared in the same file.
3. Add a unit test in `internal/serve/api/<resource>_test.go` using `httptest.NewRecorder` and stub implementations of those interfaces.
4. Wire the route in `internal/serve/server.go:registerRoutes` as one of:
   - `mux.Handle("GET /api/...", authHF(api.Foo(...)))` for read.
   - `mux.Handle("POST /api/...", authHF(api.RequireOriginFunc(allowedOrigins, api.Foo(...))))` for mutation.
   - `mux.HandleFunc("/...", api.Bar(...))` for **unauthenticated** liveness only (currently just `/healthz`).
5. If the handler needs ingest / attention / quota / cost data, route through one of the adapter types defined at the bottom of `server.go` (`quotaEnricher`, `sessionSourceAdapter`, `sessionResolverAdapter`, `quotaSourceAdapter`). DO NOT import `ingest` / `attention` directly from the api package.

## Adding a new CLI subcommand

1. New file `cmd/<verb>.go`.
2. Top-level `var <verb>Cmd = &cobra.Command{Use: "<verb>", Short: "...", RunE: run<Verb>}` plus `func init() { rootCmd.AddCommand(<verb>Cmd) }`.
3. `func run<Verb>(cmd *cobra.Command, args []string) error { ... }` — call `proc.EnsureServeRunning(cmd.Context())` if the verb implies a daemon should be running; call `ensureSetup()` if it touches state.
4. New file `cmd/<verb>_test.go` with a table-driven test exercising flags + positional args.
5. If the verb has flags, declare them at file scope and bind in `init()`.

## Adding a new config field

1. Add the field to `Config` (or `ServeConfig` / `AttentionThresholds`) in `internal/config/config.go` with the `json:"..."` tag.
2. Update `Default()` to set the new default.
3. If the field is optional and zero-valued should fall back to a constant, add a `Resolved*()` accessor that does so. Mirror `LogPolicy()` / `HookTimeout()` / `(s ServeConfig) ResolvedPort()`.
4. **If the change is non-additive** (renaming a field, changing a type), bump `SchemaVersion` and append a `migrate.Step` to `MigrationPlan().Steps`.
5. Add a unit test in `internal/config/config_test.go` covering the legacy-config and new-config round trip.

## Adding a new lifecycle hook event

1. New event constant in `internal/hooks` `[inferred — verify via `cat internal/hooks/hooks.go`]`.
2. Call `fireHook("<event>", sess)` and `fireServeEvent("<event>", sess)` at the trigger site in `cmd/`.
3. Document the event + its `CTM_SESSION_*` env vars in the README's "Hooks" section. `[inferred location — verify via `grep -n hooks /home/dev/projects/ctm/README.md`]`.

## Things to avoid (anti-patterns)

- Don't introduce a new HTTP routing framework (chi, echo, gin). The codebase deliberately uses Go 1.22+ stdlib `http.ServeMux` with path patterns and is wired in a single function.
- Don't introduce dependency-injection containers (wire, fx, dig). Constructor injection by hand in `serve.New` is the convention.
- Don't introduce ORMs (gorm, ent, sqlc). The SQLite layer hand-writes SQL in `cost_store.go` / `search_store.go`.
- Don't introduce JSON-decoder helpers — use `internal/jsonstrict` for state files, plain `encoding/json` elsewhere.
- Don't add log frameworks (zap, logrus). `slog` only.
- Don't add validation libraries (go-playground/validator). Inline checks (`session.ValidateName`) are the pattern.
- Don't run `go test` without `-tags sqlite_fts5` and expect anything `internal/serve/store/...` to work. (See PROJECT_SUMMARY Gotchas.)

## Don't refactor (intentional non-standard choices)

- **Hand-rolled cobra dispatcher with one-file-per-verb in flat `cmd/`.** ~34 verbs but each file is small. The team optimized for "find the verb file by name" reading. Don't introduce sub-packages, code generation, or a dispatcher map. (Confirmed by the homogeneous shape of `cmd/serve.go`, `cmd/yolo.go`, `cmd/overlay.go`, `cmd/install.go`.)
- **Single `registerRoutes` function in `internal/serve/server.go` declaring ALL routes inline.** It's ~150 lines of `mux.Handle(...)` calls. The team prefers one canonical place to read the surface area. Don't split into per-resource registration files. The verification exception in the project-summarizer skill exists because of patterns exactly like this.
- **In-memory auth store (`internal/serve/auth/sessions.go`) without persistence.** Tokens vanish on daemon restart. This is intentional given the loopback-only deployment model — losing the token is the same as needing to log back in after a reboot. Don't add a SQLite-backed user table without explicit ask.
- **`internal/serve/dist/` is part of the source tree solely so `//go:embed all:dist` works.** The `Makefile` rsyncs `ui/dist/` into it with `--delete`. Don't switch to `//go:embed ../../ui/dist` — Go rejects parent-relative embed paths. Don't check the embed directory's contents into the diff (it's listed in `.gitignore`).
- **Hardcoded `serveAddr = "127.0.0.1:37778"` in `internal/serve/proc/spawn.go`** instead of importing `internal/serve.DefaultPort`. Comment in the file explains: avoids pulling the daemon's transitive imports into every CLI call site.
- **`shouldResumeExisting` ignores tmux liveness on purpose.** Doc comment in `cmd/yolo.go` explains the regression that prompted this. Don't re-add the tmux-alive precondition.
- **Statusline + log-tool-use are hidden cobra subcommands of the `ctm` binary itself**, not separate binaries. The overlay file embeds `<absolute-path-to-ctm> statusline` / `log-tool-use` so claude hooks keep working even if `PATH` changes between when overlay was generated and when claude runs.
- **No tailwind.config.js.** TailwindCSS v4 uses CSS-first config (`@theme` blocks). Don't add a config file.
- **The `ctm` binary is committed at the repo root** despite being in `.gitignore`. `[inferred from `ls -la` showing the executable + .gitignore listing it]`. Likely a stale checkpoint; rebuild before testing.
