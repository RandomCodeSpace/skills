# Key Flows

Four flows worth tracing through code, in order of importance for an agent making changes:

1. `ctm attach <name>` — the default user-facing flow.
2. `ctm serve` startup — how the daemon comes up and wires its background goroutines.
3. PostToolUse JSONL → search index → SSE feed — how data flows from claude to the UI.
4. Web UI mutation (e.g. send-input) — how the SPA hits the API and what it triggers.

---

## Flow: `ctm attach <name>`

**Trigger:** User runs `ctm` (no args → default name `claude`) or `ctm <name>`. With one positional arg, `cobra.MaximumNArgs(1)` accepts; `init()` in `cmd/attach.go` sets `rootCmd.RunE = runAttach`.

**Path through code:**

1. `main.go:5` → `cmd.Execute()` → cobra parses args → `runAttach` (`cmd/attach.go:38`).
2. `cmd/attach.go:42-47` — name defaulting + `session.ValidateName(name)`.
3. `cmd/attach.go:55` — `proc.EnsureServeRunning(cmd.Context())`. Best-effort spawn of `ctm serve` in the background; never blocks.
4. `cmd/attach.go:58` — `ensureSetup()` (defined elsewhere in `cmd/`) loads `Config` from `config.ConfigPath()` and runs any one-time bootstrap.
5. `cmd/attach.go:64-65` — `session.NewStore(config.SessionsPath())` (read-through of `~/.config/ctm/sessions.json`); `tmux.NewClient(config.TmuxConfPath())`.
6. `cmd/attach.go:67-73` — `store.Get(name)`:
   - On error (not found): `createAndAttach` (`cmd/attach.go:77`) → `session.Yolo(...)` → tmux new-session via `tc.Go(name)` → `fireHook("on_new", &sess)` + `fireServeEvent("session_new", ...)` + `fireServeEvent("session_attached", ...)` (`cmd/attach.go:97-99`) → return.
   - On hit: `preflight(sess, cfg, store, tc, out)` (`cmd/attach.go:73`) — runs cached health check (`healthCacheValid` short-circuit at line 34) + slow checks (env, PATH, workdir, claude liveness). Multiple branches end with `fireHook("on_attach", sess)` + `fireServeEvent("session_attached", sess)` (lines 152-153, 176-177, 193-194).
7. tmux client attaches the user's terminal: `tc.Go(name)` (`cmd/attach.go:103`).

**Side effects:**
- `~/.config/ctm/sessions.json` updated with `LastAttachedAt` (`store.UpdateAttached`).
- `tmux new-session -d -s <name>` (or attach to existing).
- A claude subprocess is started inside that tmux pane, with `--settings <overlay>` if `claude-overlay.json` exists and `env.sh` sourced if `EnvFilePath()` exists.
- `ctm serve` is auto-spawned (no-op if running).
- User shell hooks fire (best-effort, swallowed errors).
- Daemon hub publishes `session_new`/`session_attached` to all SSE subscribers.

**Failure modes:**
- `session.ValidateName` rejects bad names → returns user-facing error.
- `ensureSetup` config load failure → returns error (cobra prints + exits 1 via `main.go`).
- Preflight failures may auto-recover (mark session `"recovered"` / `"recreated"`) before bubbling up.
- tmux not on `$PATH` or version <3.0 → preflight fails with an actionable message (`internal/health/tmux_check.go`).
- Hook execution failure → swallowed; only visible at `--log-level=debug`.

---

## Flow: `ctm serve` startup

**Trigger:** `ctm serve` (manual) or `proc.EnsureServeRunning(ctx)` from any of attach/new/yolo. Cobra wires the command in `cmd/serve.go:17-21`.

**Path through code:**

1. `cmd/serve.go:24-72` (`serveCmd.RunE`):
   1. Install signal handler: `signal.NotifyContext(ctx, SIGINT, SIGTERM)`.
   2. Load `config.Load(config.ConfigPath())`. Failure is non-fatal — fall back to zero values (slog WARN at `cmd/serve.go:46`).
   3. Build `serve.Options` from config + ldflags `Version` + `attentionThresholdsFrom(cfg.Serve.Attention)` (`cmd/serve.go:80-89`).
   4. `serve.New(opts)` (`internal/serve/server.go`):
      - `net.Listen("tcp", "127.0.0.1:<port>")`. If `EADDRINUSE` and the existing listener returns the `X-Ctm-Serve` header on `/healthz` (`probeIsCtmServe`), return `ErrAlreadyRunning`. Otherwise hard-fail.
      - Construct `auth.NewStore()`, `events.NewHub(0)`, `tmux.NewClient(tmuxConf)`, `session.NewStore(sessionsPath)`, `store.OpenCostStore(filepath.Join(config.Dir(), "ctm.db"))` (SQLite WAL), the projection / tailers / quota ingester / attention engine / webhook dispatcher.
      - Wire HTTP routes into a `*http.ServeMux` `[inferred — server.go is 33KB; the only place to wire ~25 handlers]`. Mount auth middleware on `/api/*`. SPA fallback excludes `/api/` and `/events/` (`assets.go:43`).
   5. `srv.Run(ctx)`:
      - Spin up background goroutines: Hub broadcaster, Projection watcher (fsnotify on `sessions.json`), TailerManager (per-file tailer for each `<session>.jsonl` in `logDir`), QuotaIngester (watches `StatuslineDumpDir`), AttentionEngine (consumes hub events), WebhookDispatcher (if URL set).
      - `http.Server.Serve(listener)` with `BaseContext` set to a cancellable child of `ctx` (`requestCtx` / `requestCancel`). On cancellation, that context propagates to long-lived SSE handlers via `<-r.Context().Done()`.
      - Wait for SIGINT/SIGTERM or `Server.Shutdown(reason)` (in-process shutdown trigger e.g. PATCH /api/config).
      - `http.Shutdown(graceCtx)` drains in-flight requests, cancels SSE, returns.
2. On `ErrAlreadyRunning` (`cmd/serve.go:65-67`), the command returns `nil` (silent success).

**Side effects:**
- Loopback bind on `127.0.0.1:37778`.
- SQLite DB at `~/.config/ctm/ctm.db` opened (created on first run).
- File watchers on `sessions.json`, `logDir`, `StatuslineDumpDir`.
- Optional outbound webhook ready to fire.

**Failure modes:**
- Port collision with non-ctm-serve listener → exit 1 with explanatory message; does not kill the foreign listener (intentional).
- SQLite open failure → `New()` returns wrapped error; daemon does not start.
- Config load failure → degraded start (zero values + WARN), not a hard failure.

---

## Flow: PostToolUse JSONL → search index → SSE feed

**Trigger:** Claude Code invokes the `PostToolUse` hook for every tool call. The hook command is registered via the ctm overlay (`cmd/overlay.go init` writes `claude-overlay.json` with `"hooks": { "PostToolUse": "ctm log-tool-use ..." }`). Each invocation runs `cmd/log_tool_use.go` `[inferred command name from filename and README phrasing]`.

**Path through code (write side):**

1. `cmd/log_tool_use.go` reads the hook payload from stdin (Claude Code passes JSON via stdin `[inferred — Claude Code convention]`), wraps it with a UTC timestamp, and appends a single JSON line to `<logDir>/<session-uuid>.jsonl`. Path is sanitized; perms 0600; advisory `flock` for concurrent writes (`README.md` Logs).
2. `internal/logrotate` checks size; if cap exceeded, rename to `<file>.<unix-nano>`, gzip in place, prune by age/count caps, create a fresh active file.

**Path through code (read side, daemon):**

3. `internal/serve/ingest/tailer_manager.go` runs one fsnotify-driven goroutine watching `logDir`. New files spawn a `tailer.go` reader. Rotated `.gz` files are tracked but not actively tailed.
4. `tailer_parse.go` parses each new line and emits an event onto `events.Hub` (`[inferred — naming + presence of subscriber.go in store/]`).
5. `internal/serve/store/tool_call_subscriber.go` consumes the hub event and writes to:
   - `cost_store.go` — token/cost rollups for the dashboard chart.
   - `search_store.go` — FTS5 row for V19 search.
6. UI `useFeed`/`useFeedHistory` consumes `/api/sessions/:name/feed` (`internal/serve/api/feed.go`) and `/api/sessions/:name/feed/history` (`feed_history.go`); `useEventStream` subscribes to `/events` for live deltas.

**Side effects:**
- Append-only JSONL file (rotated, gzipped).
- SQLite WAL writes (cost + FTS5).
- Hub broadcast → all SSE subscribers.

**Failure modes:**
- JSONL file > 50 MiB before rotation kicks in (e.g. burst): rotation triggers on next append.
- FTS5 missing (`sqlite_fts5` build tag absent): daemon panics at `store.OpenCostStore` or first FTS5 write — see Gotchas in `PROJECT_SUMMARY.md`.
- Tailer read error → tailer logs WARN and continues; no data loss for the line that errored (`[inferred from typical tail.Tail patterns; verify in tailer_test.go]`).
- Hub overflow: `NewHub(0)` (`server.go`) is the construction; whether `0` means unbounded or a default needs verification in `events/hub.go`. `[inferred]`.

---

## Flow: Web UI mutation (send input to a session)

**Trigger:** User types in `<SessionInputBar>` and presses Enter. `useSendInput` mutation is called.

**Path through code:**

1. UI: `ui/src/components/SessionInputBar.tsx` → `useSendInput` (`ui/src/hooks/useSendInput.ts`) — React Query mutation wrapping `lib/api.ts` POST.
2. Browser: `POST /api/sessions/:name/input` with the typed text. `lib/api.ts` includes the session cookie set by the auth middleware.
3. Daemon: `auth.middleware` (`internal/serve/auth/middleware.go`) validates the cookie/session, hands off to `internal/serve/api/input.go` handler.
4. `input.go` calls into the daemon's `tmuxClient` (`*tmux.Client`) to send keys to the named tmux session (`tmux send-keys -t <session> "<text>" Enter`-equivalent — exact API in `internal/tmux/client.go`).
5. Claude (running inside the tmux pane) processes the input; eventually emits PostToolUse hooks → see Flow #3 → SSE delta back to UI.
6. UI: React Query invalidates relevant queries on mutation success (`[inferred from typical react-query usage in useSendInput.ts]`); `<FeedStream>` updates from SSE.

**Side effects:**
- tmux send-keys to the live pane (visible to anyone else attached to the same session).
- Eventual JSONL log line for the resulting tool call.

**Failure modes:**
- Cookie expired or missing → 401, `lib/api.ts` throws `UnauthorizedError`, `App.tsx` retry policy short-circuits, AuthProvider redirects to `/login` (`AuthGate.tsx`).
- Session name not found in projection → 404 from `input.go`.
- tmux pane gone (session was killed externally) → `tmux send-keys` errors; handler returns 5xx with a hint to re-attach.
- Rate limit hit (`auth/ratelimit.go`) → 429.

---

**Not yet documented (good follow-up flows):**

- YOLO checkpoint creation (`cmd/yolo.go:gitCheckpoint`) — what `git add`/`git commit` runs, where the marker tag would go (currently absent — `docs/robustness-audit.md` row 7).
- Login / signup → `/api/auth/{signup,login}` → `auth.Save(user)` → cookie issuance.
- Config update → `PATCH /api/config` → `config_update.go` → on-disk write → optional `Server.Shutdown("config-changed")` for hot-reload-via-respawn.
- `ctm pick <filter>` and `ctm last` mobile selection flows (`cmd/pick.go`, `cmd/last.go`).
