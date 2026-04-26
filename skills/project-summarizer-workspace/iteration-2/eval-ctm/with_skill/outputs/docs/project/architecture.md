# Architecture

## High-level shape

ctm is a **single Go binary** wearing two hats:

1. **CLI** — Cobra-driven verbs (`attach`, `new`, `yolo`, `safe`, `kill`, `pick`, `last`, `ls`, `doctor`, `check`, `install`, `overlay`, `logs`, `statusline`, `log-tool-use`, etc.) that manage `tmux` sessions running `claude`.
2. **HTTP daemon** — `ctm serve`: an authenticated REST + SSE service on `127.0.0.1:37778` backed by an in-memory event hub, a sessions projection, several background goroutines (tailers, attention engine, webhook dispatcher), and an embedded React SPA served under `/`.

The CLI **auto-spawns** the daemon (`internal/serve/proc.EnsureServeRunning`) on every claude-launching command, so users rarely run `ctm serve` by hand. The single binary contains the entire UI: `make ui` rsyncs `ui/dist/` into `internal/serve/dist/`, and `internal/serve/assets.go` declares `//go:embed all:dist`.

```
                 +------------------+         +----------------------------+
   user/CLI ---> |  cobra rootCmd   | ------> |  internal/serve/proc       |
                 |  (cmd/*.go)      |         |  EnsureServeRunning        |
                 +------------------+         +----------------------------+
                          |                                  |
                          | tmux exec                         | fork-exec
                          v                                  v
                 +------------------+         +----------------------------+
                 |    tmux + claude  |         |  ctm serve (HTTP daemon) |
                 |  (per session)   |         |  127.0.0.1:37778         |
                 +------------------+         +----------------------------+
                                                          ^      ^
                                                          | SSE  | REST
                                                  +-------+------+-------+
                                                  |   Browser / Mobile  |
                                                  |  (embedded React SPA)|
                                                  +---------------------+
```

## Components

### `cmd/` — CLI dispatch

- **Lives in:** `cmd/`
- **Responsibility:** One file per verb, each with `var <verb>Cmd = &cobra.Command{...}` and an `init()` that registers it on `rootCmd`. Cross-cutting helpers (`fireHook`, `fireServeEvent`, `ensureSetup`, `gitCheckpoint`, `resolveWorkdir`) live in shared files (`hooks_dispatch.go`, `bootstrap.go`, `yolo.go`).
- **Key files:**
  - `cmd/root.go` — `rootCmd` + `Version` ldflags hook + slog setup in `PersistentPreRunE`.
  - `cmd/attach.go` — `runAttach` (also bound to `rootCmd.RunE` in its `init()` — this is what `ctm <name>` runs).
  - `cmd/yolo.go` — `runYolo`, `runYoloBang`, `runSafe`, plus `gitCheckpoint`, `resolveWorkdir`, `shouldResumeExisting`.
  - `cmd/serve.go` — wires `internal/serve.New` from `internal/config`.
  - `cmd/overlay.go` — claude `--settings` overlay management.
  - `cmd/statusline.go` — hidden Claude `statusLine.command` target.
  - `cmd/log_tool_use.go` — hidden Claude `PostToolUse` hook target.
  - `cmd/bootstrap.go` — `ensureSetup()`: idempotent first-run config + tmux.conf + overlay sidecars + alias injection + log pruning.
- **Talks to:** `internal/session`, `internal/tmux`, `internal/claude`, `internal/serve/proc` (auto-spawn), `internal/hooks` (user-defined shell hooks), `internal/serve/proc.PostEvent` (in-process daemon notify).
- **Owns:** Nothing persistent. Defers to `internal/config` and `internal/session/Store` for state.

### `internal/serve/` — HTTP daemon

- **Lives in:** `internal/serve/`
- **Responsibility:** Single-instance loopback HTTP server bundling REST, SSE, embedded SPA, background tailers, attention engine, webhook dispatcher, and a SQLite cost store.
- **Key files:**
  - `server.go` — `New()`, `Run(ctx)`, `Shutdown()`, `registerRoutes()`. Long: ~700 lines, mostly route table + adapter types that bridge `api`-package interfaces to `ingest` / `attention` internals.
  - `assets.go` — `//go:embed all:dist` + `assetHandler()` that falls through unknown paths to `index.html` for SPA client-side routing.
  - `pane_ready.go` — Polls tmux pane for input-readiness before forwarding `POST /api/sessions/{name}/input`.
  - `sockerr.go` — `isAddrInUse` + `probeIsCtmServe` (uses `X-Ctm-Serve` header on `/healthz`) for the single-instance guard.
- **Talks to:** sub-packages (`api/`, `auth/`, `events/`, `ingest/`, `git/`, `store/`, `webhook/`, `attention/`, `proc/`); shared `internal/session.Store`, `internal/tmux.Client`, `internal/config`.
- **Owns:** the listener on `:37778`, the `events.Hub`, the `ingest.Projection`, the SQLite handle, all background goroutines.
- **Goroutine inventory** (started in `Run`): `proj.Run`, `quota.Run`, `attention.Run`, `webhook.Run`, `store.SubscribeQuotaWriter` (cost), an FTS subscriber, the `tailers.Run` loop. Each goroutine listens on a child context derived from `Run`'s ctx; `Shutdown(reason)` cancels the root ctx so all unwind.

### `internal/serve/api/` — handlers

- **Lives in:** `internal/serve/api/`
- **Responsibility:** One file per resource family. Each handler is a factory function returning `http.HandlerFunc`, taking its dependencies via interface parameters defined adjacently (no global state, no DI framework).
- **Files (resource → file):** sessions, sessions_test, attach_url, bootstrap, checkpoints, checkpoints_cache, cost, diff, doctor, forget, health, healthz, input, kill, pane, quota, revert, search, sessions_proj_create, subagents, teams, tool_call_detail, auth (signup/login/logout/status/origin), require_origin, mux helpers (writeJSON, errorBody).
- **Key conventions:**
  - Path variables use Go 1.22+ `r.PathValue("name")` — no chi/gorilla.
  - JSON envelopes: success returns the object directly; errors return `{"error": "code", ...}`.
  - Streaming: SSE handler at `internal/serve/events/handler.go`. Auth via bearer token in query string OR header (so EventSource can authenticate without `@microsoft/fetch-event-source`).

### `internal/serve/auth/` — V27 password auth

- **Lives in:** `internal/serve/auth/`
- **Responsibility:** Bcrypt password storage, session-cookie/bearer-token store, login rate limiter, request middleware.
- **Key files:** `password.go` (bcrypt cost), `sessions.go` (in-memory token map; `Lookup`, `Seed` — last for tests), `ratelimit.go` (token-bucket limiter, used on `/api/auth/login`), `middleware.go` (`WithUser` context plumbing), `user.go` (User type), `context.go` (request-scoped User accessor).
- **Note:** No persistent user table at the time of writing; auth state is in-memory and lost on daemon restart. `[inferred]` from `auth.NewStore()` returning a struct with no DB handle. Verify via `grep -n 'sqlite\\|persist' internal/serve/auth/*.go`.

### `internal/serve/ingest/` — read-side projection + tailers

- **Lives in:** `internal/serve/ingest/`
- **Responsibility:** Maintain a live projection of `sessions.json` plus quota, tool calls, and subagent activity tailed from the JSONL logs.
- **Key files:**
  - `sessions_proj.go` — `Projection.Run(ctx)` polls `sessions.json` + tmux liveness; exposes `All()`, `Get(name)`, `TmuxAlive(name)`.
  - `tailer.go`, `tailer_manager.go`, `tailer_parse.go` — Per-claude-session JSONL tailers with offset persistence, parsing into structured tool-call events.
  - `quota.go` — `QuotaIngester` reads `CTM_STATUSLINE_DUMP` payloads from a directory the statusline subcommand writes to; surfaces `Snapshot()` (global) + `PerSessionSnapshot(name)`.
  - `subagent.go` — Tracks per-session subagent trees from tool-call events.

### `internal/serve/store/` — SQLite

- **Lives in:** `internal/serve/store/`
- **Responsibility:** Persistent cost history + FTS5 search over tool-call payloads.
- **Key files:**
  - `cost_store.go` — Opens `ctm.db` in WAL mode; schema includes a `cost_rows` table and a `tool_calls_fts` virtual table (FTS5). Wipes the FTS index on boot so the tailer's offset-0 replay rebuilds it.
  - `search_store.go` — `SearchFTS(q)` runs `MATCH` queries via `fts5QuotePhrase` (escapes embedded double quotes per FTS5 grammar).
  - `subscriber.go`, `tool_call_subscriber.go` — Hub subscribers that write rows; one for cost, one for the FTS index.

### `internal/serve/events/` — SSE hub

- **Lives in:** `internal/serve/events/`
- **Responsibility:** In-process pub/sub with optional last-event-id replay; HTTP/SSE handler.
- **Key files:** `event.go` (typed event struct), `hub.go` (`Hub.Publish`, `Subscribe(after lastEventID, sessionFilter)`, `Stats()`), `hub_test.go`, plus the SSE `Handler` in `internal/serve/events/handler.go` `[inferred — file present per `internal/serve/server.go:registerRoutes` referencing `events.Handler`]`.

### `internal/serve/attention/` + `internal/serve/webhook/`

- **Lives in:** `internal/serve/attention/`, `internal/serve/webhook/`
- **Responsibility:** Attention triggers A..G (idle, quota, error rate, context %, yolo unchecked, checkpoint stale) compute per-session state. Webhook dispatcher debounces and retries `attention_raised` deliveries to a user-configured URL.
- **Key files:** `attention/engine.go` (the trigger loop) `[inferred — file list not directly enumerated in this survey; verify via `ls internal/serve/attention/`]`; `webhook/dispatcher.go` (`Run`, `Dispatch`, debounce window, retry policy).

### `internal/session/` — session domain

- **Lives in:** `internal/session/`
- **Responsibility:** The `Session` struct, UUID v4 generation, name validation/sanitization, JSON-on-disk store with flock locking, the reusable `Yolo` spawn helper.
- **Files:** `state.go` (Store + diskData + flock), `state_test.go`, `state_property_test.go`, `session.go` (Session struct + ValidateName + SanitizeName + New) **(file is `state.go` — there is no `session.go`; the README references types defined here)**, `spawn.go` (Yolo: tmux NewSession + Store.Save), `spawn_test.go`, `uuid.go`, `uuid_test.go`.
- **Talks to:** `internal/tmux`, `internal/claude` (for `BuildCommand`).
- **Owns:** `~/.config/ctm/sessions.json` via flock-based locking.

### `internal/claude/` — Claude CLI integration

- **Lives in:** `internal/claude/`
- **Responsibility:** Build the shell command line for `claude` (with `--resume`/`--session-id` fallback chain, `--settings <overlay>`, `--dangerously-skip-permissions` for yolo, env-file source-before-exec). Plus a JSONPatch helper, a TUI wrapper, and a remote-control facility.
- **Files:** `command.go` (`BuildCommand`, `OverlayPathIfExists`, `EnvFilePathIfExists`, `shellQuote`), `process.go`, `jsonpatch.go`, `remote_control.go`, `tui.go`.

### `internal/tmux/` — tmux wrapper

- **Lives in:** `internal/tmux/`
- **Responsibility:** Thin `*Client` over `tmux` exec — `NewSession`, `KillSession`, `HasSession`, `SendKeys`, `PaneCurrentPath`, plus `GenerateConfig` for the per-user `tmux.conf`.
- **Files:** `client.go`, `client_test.go`, `config.go`, `config_test.go`.

### Other internal packages

- `internal/config` — Typed config + paths (`Dir()`, `ConfigPath()`, `SessionsPath()`, `TmuxConfPath()`, `ClaudeOverlayPath()`, `EnvFilePath()`, `AllowedOriginsPath()`) + `MigrationPlan()`.
- `internal/migrate` — Generic versioned-JSON migrator.
- `internal/jsonstrict` — Strict JSON decoder with one-shot self-heal for unknown keys.
- `internal/health` — Pre-flight checker (`checker.go`, `claude_check.go`, `tmux_check.go`, `env.go`).
- `internal/doctor` — Shared probe primitives used by both the CLI doctor and the JSON `/api/doctor` endpoint.
- `internal/output` — Colored printer that respects `--log-level` for diagnostic mute.
- `internal/logging` — slog handler factory; honors `--log-level` and `CTM_LOG_FORMAT=json`.
- `internal/logrotate` — Size/age/count file pruner used by `pruneSessionLogs`.
- `internal/hooks` — User-defined shell-hook runner. Errors logged at WARN, never propagated.
- `internal/shell` — bash/zsh rc-file alias injection + completion helpers.
- `internal/prompt` — Prompt-related path helpers (`path.go`). `[inferred — only file is path.go; semantics unclear without reading. Verify via `cat internal/prompt/path.go`.]`

## Layering / dependency rules

- `cmd/*` → `internal/*` only. Command files never import each other (cross-cutting helpers go in shared `cmd/<name>.go` files like `hooks_dispatch.go`).
- `internal/serve/*` may import `internal/{config, session, tmux, claude}` but not `cmd/`.
- `internal/serve/api/*` is pure handlers — it imports `internal/serve/{ingest, store, auth, events, git}` via interface adapters defined in `server.go`. Reverse imports (api → serve internals) are avoided to keep dependency direction one-way.
- The `internal/serve/proc/` package is the only thing in `internal/serve/` that the CLI commands import directly (for `EnsureServeRunning` + `PostEvent`). It hardcodes `serveAddr = "127.0.0.1:37778"` rather than importing `internal/serve.DefaultPort` to avoid pulling in the daemon's transitive imports. (See `internal/serve/proc/spawn.go:29-31`.)

## Cross-cutting concerns

- **Logging:** `log/slog`, configured in `internal/logging/Setup(level)`. Default `info`. Format selectable via `CTM_LOG_FORMAT=json` (NDJSON) or default text. Always to stderr.
- **Error handling:** Plain Go `error`. Errors that should not block user flow (hook failures, lifecycle event publishes, daemon spawn failures, log pruning) are explicitly swallowed at the caller and noted in comments. CLI commands return non-nil error → cobra prints + non-zero exit.
- **Auth / authz:** V27 password auth (bcrypt) in the daemon. Bearer token in `Authorization: Bearer <tok>` for REST + SSE. `Origin` allowlist for mutation routes (CSRF defense). `/healthz` and `/api/auth/status` are unauthenticated. The CLI itself has no auth — it operates on local files.
- **Observability:** `/api/doctor` mirrors `ctm doctor` over JSON. `/health` exposes hub stats (subscriber count, publish counters). `/debug/hub` is a deeper introspection endpoint behind auth.
- **Config:** Loaded from `~/.config/ctm/config.json` via `internal/config.Load` (strict + self-healing). `Default()` provides built-ins; per-field `Resolved*()` accessors fall back to constants for fields left at zero, so old configs keep working without schema bumps. Env vars override only `CTM_LOG_FORMAT`, `CTM_ALLOWED_ORIGINS`, `CTM_STATUSLINE_DUMP`. Config precedence: env (where applicable) > file > built-in defaults.

## Why it's shaped this way

- **Single binary with embedded SPA** — chosen so the install path is one `go install` (or one prebuilt tarball download) on the user's box. The single-instance daemon model lets the CLI auto-spawn a server without burdening the user with systemd units. (`README.md` Quickstart, `release.yml` artifact set.)
- **Daemon never attaches to tmux** — keeps the daemon restartable without dropping a user's interactive session. The CLI owns attach; the daemon owns observation. (`internal/session/spawn.go` package comment.)
- **Two persistence layers** (JSON for source-of-truth state; SQLite for derived/cost/search) — JSON is human-editable and survives a wiped daemon DB; SQLite gives FTS5 + bounded-time inserts the JSON path can't. The SQLite index is intentionally rebuilt on boot from the JSONL replay. (`internal/serve/store/cost_store.go` schema comment.)
- **Hand-rolled cobra subcommands instead of generation** — The codebase has 30+ verbs, but the per-verb file is small (~80–250 lines) and the team optimized for "find the verb file by name" reading. Don't refactor.
