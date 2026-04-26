# Architecture

## High-level shape

ctm is a single statically-linked Go binary that wears two hats. The CLI side is a Cobra-driven manager that creates/attaches/kills tmux sessions running the `claude` CLI, with per-session state in JSON files under `~/.config/ctm/`. The daemon side is `ctm serve`, an HTTP server bound to `127.0.0.1:37778` that exposes a REST + SSE API and serves an embedded React SPA for monitoring and steering those sessions from a phone over SSH-forwarded loopback. The two sides communicate one-way via lifecycle POSTs (`cmd/hooks_dispatch.go:fireServeEvent` → `proc.PostEvent` → `/api/hooks/:event`) and shared state files (`sessions.json`, JSONL tool-use logs, statusline dump dir).

```
                       ┌─────────────────────────────────────────────┐
  user (CLI)           │                  ctm binary                 │
  ─────────────────────┤                                             │
  ctm attach foo       │  cmd/ (Cobra)                               │
  ctm yolo / new       │   └─ attach.go ───┐                         │
  ctm logs / doctor    │      kill.go      │ fireHook ── shell hook  │
  ctm serve            │      yolo.go      │ fireServeEvent ─┐       │
                       │      ...          │                  │      │
  user (browser)       │                   ▼                  ▼      │
  ─────────────────────┤  internal/                 POST /api/hooks  │
  https on loopback    │   ├ tmux/ ── exec("tmux") ─────► tmux server│
  https://localhost:5173 (dev) / 127.0.0.1:37778 (prod)              │
                       │   ├ claude/ ── exec("claude")                │
                       │   ├ session/ ── ~/.config/ctm/sessions.json  │
                       │   ├ config/  ── ~/.config/ctm/config.json    │
                       │   ├ hooks/   ── user shell hooks runner      │
                       │   ├ logrotate/ ─ JSONL rotation+gzip         │
                       │   └ serve/                                   │
                       │      ├ server.go (net/http, routes, BG jobs) │
                       │      ├ api/<resource>.go × ~25 (handlers)   │
                       │      ├ auth/ ── single-user, session cookie  │
                       │      ├ events/ Hub ─► SSE /events            │
                       │      ├ ingest/ ── fsnotify watchers          │
                       │      │     ├ Projection (sessions.json)      │
                       │      │     ├ TailerManager (JSONL tool logs) │
                       │      │     └ QuotaIngester (statusline dumps)│
                       │      ├ store/  SQLite ctm.db (cost, search)  │
                       │      ├ git/    git checkpoint/diff/revert    │
                       │      ├ webhook/ optional outbound POST       │
                       │      └ assets.go //go:embed ui/dist/         │
                       └─────────────────────────────────────────────┘
```

## Components

### `cmd/` — CLI surface

- **Lives in:** `cmd/`
- **Responsibility:** One Cobra subcommand per file. `main.go` calls `cmd.Execute()`; `cmd/root.go` defines the root + persistent flags (`--verbose`, `--log-level`); `cmd/attach.go:init()` sets `rootCmd.RunE = runAttach` so bare `ctm` defaults to attach.
- **Key files:** `root.go`, `attach.go`, `serve.go`, `new.go`, `kill.go`, `yolo.go`, `last.go`, `pick.go`, `list.go`, `rename.go`, `forget.go`, `detach.go`, `bootstrap.go`, `install.go`, `overlay.go`, `auth.go`, `check.go`, `doctor.go`, `version.go`, `completion.go`, `switchcmd.go`, `logs.go`, `log_tool_use.go` (PostToolUse hook target), `statusline.go` (claude statusline target), `hooks_dispatch.go` (fan-out helpers).
- **Talks to:** `internal/session` (state), `internal/tmux` (tmux subprocess), `internal/claude` (claude subprocess), `internal/health`/`internal/doctor` (preflight), `internal/serve/proc` (best-effort daemon spawn + event POST).
- **Owns:** No state of its own — everything goes through `internal/...` packages.

### `internal/config` — paths & schemas

- **Lives in:** `internal/config/`
- **Responsibility:** Where state files live; the `Config` Go struct (`config.json`); `ServeConfig` and `AttentionThresholds` sub-structs; `HookTimeout()` and `Resolved()` helpers that map zero-fields to defaults.
- **Key files:** `config.go` (~250 lines based on grep). Path helpers at lines 215-250: `ConfigPath()`, `SessionsPath()`, `TmuxConfPath()`, `ClaudeOverlayPath()`, `EnvFilePath()`, `Dir()`.
- **Owns:** Defaults — `DefaultServePort = 37778`, `DefaultAttentionErrorRatePct = 20`, `…IdleMinutes = 5`, `…QuotaPct = 85`, `…ContextPct = 90`, `…YoloUncheckedMinutes = 30`, `DefaultAttentionErrorRateWindow = 20`.

### `internal/session` — session state model

- **Lives in:** `internal/session/`
- **Responsibility:** `Session` struct, JSON-file `Store` keyed by `sessions.json`, `Yolo()` spawn entrypoint used by attach.
- **Talks to:** `internal/tmux`, `internal/claude`, `internal/jsonstrict`, `internal/migrate`.
- **Owns:** `~/.config/ctm/sessions.json`. Health timestamps (`LastHealthAt`, `LastHealthStatus`).

### `internal/tmux` — tmux subprocess wrapper

- **Lives in:** `internal/tmux/`
- **Key files:** `client.go` (subprocess wrapper — Go, NewSession, AttachSession, KillSession etc. `[inferred from caller usage]`), `config.go` (writes ctm-managed `tmux.conf` — sets `set-clipboard on` for OSC52, etc.), `client_test.go`, `config_test.go`.
- **Owns:** The ctm-managed tmux conf path returned by `config.TmuxConfPath()`.

### `internal/claude` — claude CLI integration

- **Lives in:** `internal/claude/`
- **Key files:** `command.go` (build claude argv, source `env.sh`), `process.go` (Linux `/proc` walk to find claude child PID), `tui.go` (TUI helpers), `remote_control.go` (steer claude via tmux send-keys `[inferred]`), `jsonpatch.go` (JSON patch for overlay merging `[inferred]`).
- **Notes:** `process.go` is Linux-only (no `runtime.GOOS` branches; `docs/robustness-audit.md` row 3).

### `internal/health` + `internal/doctor`

- **Lives in:** `internal/health/`, `internal/doctor/`
- **Responsibility:** Preflight checks (env vars, `$PATH`, workdir exists, tmux present, claude present). `health` is the cached fast path used on every attach; `doctor` is the verbose explainer for the `ctm doctor` command.
- **Cache:** `preflightCacheTTL = 60 * time.Second` (`cmd/attach.go:27`) — avoids repeated env probes on flaky mobile reconnects.

### `internal/hooks` — user-configurable lifecycle hooks

- **Lives in:** `internal/hooks/`
- **Responsibility:** Runs shell commands bound under `cfg.Hooks[event]` with a wall-clock timeout (default 5s, capped by `cfg.HookTimeoutSec`). Fed by `cmd/hooks_dispatch.go:fireHook`. Errors are swallowed and slog-warned.
- **Events:** `on_new`, `on_attach`, `on_kill`, `on_yolo`, `on_safe` (call sites in `cmd/attach.go`, `cmd/kill.go`, `cmd/yolo.go`).

### `internal/logrotate` — JSONL rotation

- **Lives in:** `internal/logrotate/`
- **Responsibility:** Size + age + count caps for `ctm logs` JSONL files. When a session log crosses the cap (default 50 MiB), rename to `<session>.jsonl.<unix-nano>`, gzip in place, prune by age (30d) / count (10) caps. Reading transparently spans active + rotated `.gz` siblings (`README.md` "Logs" / "Rotation").

### `internal/migrate` + `internal/jsonstrict`

- **Lives in:** `internal/migrate/`, `internal/jsonstrict/`
- **Responsibility:** `schema_version` migration runner, atomic write with `<path>.bak.<unix-nano>` snapshot before destructive writes. `jsonstrict` is the strict-decode wrapper (DisallowUnknownFields). All state-file readers must go through these (`README.md` Configuration section).

### `internal/serve` — HTTP daemon

- **Lives in:** `internal/serve/`
- **Responsibility:** The `ctm serve` daemon. `server.go` (33 KB; the only file at this level) constructs the listener, builds the routing table, spins up background goroutines (Hub, Projection, TailerManager, QuotaIngester, AttentionEngine, WebhookDispatcher), and serves the embedded UI as a fallback for SPA routes.
- **Key files:**
  - `server.go` — `Options`, `Server`, `New()`, `Run(ctx)`, `Shutdown(reason)`, route wiring, single-instance probe.
  - `assets.go` — `//go:embed dist/*` of the UI bundle; SPA fallback excludes `/api/` and `/events/` (`assets.go:43`).
  - `pane_ready.go` — tmux pane readiness probe used by `/api/sessions/:name/pane`.
  - `sockerr.go` — `isAddrInUse` helper.
- **Sub-packages:**

  | Sub-package | Lives in | Owns / does |
  |---|---|---|
  | `api/` | `internal/serve/api/` | One file per resource: `auth.go`, `bootstrap.go`, `checkpoints.go`, `config_get.go`, `config_update.go`, `cost.go`, `create.go`, `diff.go`, `doctor.go`, `feed.go`, `feed_history.go`, `health.go`, `hooks.go`, `input.go`, `logs_usage.go`, `mutations.go`, `origin.go`, `pane.go`, `quota.go`, `revert.go`, `sessions.go`, `subagents.go`, `teams.go`, `tool_call_detail.go`. Each colocated with `*_test.go`. |
  | `auth/` | `internal/serve/auth/` | Single-user store (`user.go` writes `~/.config/ctm/user.json` 0600 with `username`, `algo`, `params`, `salt_b64`, `hash_b64`, `created_at`). `password.go` (Argon2 likely — `[inferred]`, golang.org/x/crypto is in go.mod). `sessions.go` in-memory session store (cookie-bearer). `middleware.go` enforces auth on `/api/*`. `ratelimit.go` per-IP. `context.go` `[inferred]` for ctxkey passing user/session into handlers. |
  | `attention/` | `internal/serve/attention/` | `Engine` + `Thresholds` (`ErrorRatePct`, `ErrorRateWindow`, `IdleMinutes`, `QuotaPct`, `ContextPct`, `YoloUncheckedMinutes`). Watches the projection + ingest streams and tags sessions needing user attention. |
  | `events/` | `internal/serve/events/` | `Hub` (in-memory pub/sub, `NewHub(0)` in `server.go:New`), `Event` envelope, `sse.go` SSE handler at `/events`. |
  | `git/` | `internal/serve/git/` | Per-workdir `git checkpoint`, `diff`, `revert` for the YOLO checkpoint flow. |
  | `ingest/` | `internal/serve/ingest/` | `Projection` (read-through over `sessions.json` with fsnotify), `TailerManager` (one tailer per JSONL log file in the log dir), `tailer_parse.go` (PostToolUse JSONL parsing), `QuotaIngester` (watches statusline dumps for cost/quota signals), `subagent.go`, `sessions_proj.go`. |
  | `proc/` | `internal/serve/proc/` | `EnsureServeRunning(ctx)` (best-effort daemon spawn, no-op if already running), `PostEvent(event, form)` (POST to `/api/hooks/:event`), `spawn.go`. |
  | `store/` | `internal/serve/store/` | SQLite-backed stores (cost history, FTS5 search). Single DB at `~/.config/ctm/ctm.db`. WAL mode + batched tx (`server.go` comment, V13 cost store). `subscriber.go` + `tool_call_subscriber.go` glue stores to the Hub. |
  | `webhook/` | `internal/serve/webhook/` | Outbound webhook dispatcher (config-driven URL + `Authorization` header). Disabled when `WebhookURL` is empty. |
  | `dist/` | `internal/serve/dist/` | Embedded UI bundle (`make ui` rsync target). Sibling of `assets.go` because `//go:embed` rejects parent-relative paths. |

### `ui/` — React SPA

- **Lives in:** `ui/`
- **Responsibility:** Single-page app for monitoring/steering sessions. Compiled into `ui/dist/`, rsynced into `internal/serve/dist/`, embedded via `//go:embed`.
- See `docs/project/ui.md` for full detail.

## Layering / dependency rules

- **`cmd/` may depend on `internal/`. `internal/` must not depend on `cmd/`.** Standard Go convention; no lint rule observed (`[inferred]` — no `golangci-lint` config visible, no architecture test).
- **`internal/serve/` is a self-contained subtree.** Other `internal/` packages (`config`, `session`, `tmux`) are imported *into* `serve`; `serve` is not imported back. The CLI side reaches the daemon through `internal/serve/proc` (HTTP POST), never by direct function call.
- **`internal/serve/api/` handlers depend on the parent `internal/serve` types via constructor wiring** done in `server.go:New()`. Handlers don't reach back to construct services.
- **UI never reaches into Go internals.** The `@` alias is `ui/src/` only (`ui/vite.config.ts`, `tsconfig.app.json`). The contract between Go and UI is the HTTP API surface — all REST in `internal/serve/api/` + the `/events` SSE stream.

## Cross-cutting concerns

- **Logging:** `log/slog` configured by `internal/logging.Setup(level)` — text handler default, `CTM_LOG_FORMAT=json` switches to JSON. **Diagnostics go to stderr; user-facing status uses `internal/output.Printer` on stdout.** Mixing the two breaks scripted ctm consumers (`internal/logging/logging.go` package doc).
- **Error handling:** Go idiomatic — wrapped errors via `fmt.Errorf("...: %w", err)`. Hook fan-out (`fireHook` / `fireServeEvent`) deliberately swallows errors; the only signal is a slog WARN and observable via `--log-level=debug`. Server `New()` returns a sentinel `ErrAlreadyRunning` (`internal/serve/server.go`) that callers must treat as silent success — never as failure.
- **Auth / authz:** Single-user. `~/.config/ctm/user.json` (0600) holds username + Argon2-style `{algo, params, salt_b64, hash_b64}` (`internal/serve/auth/user.go`). Login mints a server-side session token kept in an in-memory `auth.Store`; `auth.middleware` gates every `/api/*` route. Rate-limited by IP (`auth/ratelimit.go`). Loopback-bind only (`127.0.0.1:37778`) — no TLS, no remote exposure intended.
- **Observability:** No metrics endpoint, no tracing (`docs/robustness-audit.md` row 10 lists OpenTelemetry as "no"). Health surfaces are `/healthz` + `/api/doctor`. SSE `/events` is the in-band live signal for the UI.
- **Config:** Loaded by `config.Load(config.ConfigPath())` (returns `~/.config/ctm/config.json`). Strict JSON decode with allow-list (no DisallowUnknownFields on overlay yet — `docs/robustness-audit.md` row 4). Zero-valued sub-fields fall back to defaults via `ServeConfig.Resolved()` / `AttentionThresholds.Resolved()` / `Config.HookTimeout()`. Precedence: file → built-in defaults. No env-var overrides for most fields (`CTM_LOG_FORMAT` is the exception).

## Why it's shaped this way

Two structural choices stand out and are explicitly justified in source comments:

1. **Embedded UI sibling directory (`internal/serve/dist/`).** `Makefile` header comment: "make ui produces the React bundle and copies it into internal/serve/dist/ so Go can `//go:embed` it (sibling required because go:embed rejects parent-relative paths)". This is why `ui/dist/` is rsynced rather than embedded directly.
2. **`sqlite_fts5` build tag everywhere.** `Makefile` header: "V19 slice 3 requires SQLite FTS5. mattn/go-sqlite3 compiles FTS5 in only when the `sqlite_fts5` build tag is set; applied to every go build / test / install invocation below. Binaries built without it will panic at boot on 'no such module: fts5'." V19 = log full-text search (`docs/v02/V19-search.md`).
3. **Daemon split with HTTP-only IPC.** README emphasizes "mobile-first": the CLI is what runs in tmux on the SSH host; the web UI is what the phone hits. Keeping them in one binary but communicating via local HTTP keeps the UI loosely coupled — a future `ctm-serve` rewrite (or running serve on a different host than attach) wouldn't need a shared address space. `internal/serve/proc/spawn.go:69` is the one-call seam.
