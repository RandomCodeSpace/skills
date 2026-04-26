# Key Flows

These are the four highest-leverage paths to understand. Each is a numbered call chain with file:line refs; prose is minimal.

---

## Flow: `ctm <name>` (or `ctm` alone) — attach to a session

**Trigger:** User runs `ctm` or `ctm <name>` at a shell. Cobra's `rootCmd.Args = cobra.MaximumNArgs(1)` accepts the optional positional. `cmd/attach.go:init()` set `rootCmd.RunE = runAttach`.

**Path through code:**

1. `main.go:main` → `cmd.Execute()` → cobra → `runAttach(cmd, args)` in `cmd/attach.go`.
2. `cmd/attach.go:runAttach` — validates name via `session.ValidateName`, calls `proc.EnsureServeRunning(ctx)` (best-effort spawn of `ctm serve` in the background — non-blocking).
3. `cmd/bootstrap.go:ensureSetup` — idempotent first-run: creates `~/.config/ctm/`, runs schema migrations, loads/writes `config.json`, regenerates `tmux.conf`, ensures overlay sidecars, injects shell aliases, prunes session logs. Returns `*config.Config`.
4. `cmd/attach.go:runAttach` — `store := session.NewStore(config.SessionsPath())`; `tc := tmux.NewClient(config.TmuxConfPath())`; `sess, err := store.Get(name)`.
5a. **Existing session:** → `cmd/attach.go:preflight(sess, cfg, store, tc, out)` (continues at step 6).
5b. **No session:** → `cmd/attach.go:createAndAttach(name, ".", cfg.DefaultMode, store, tc, out)` (jumps to step 9).
6. `preflight` checks `healthCacheValid(sess)` — if `LastHealthAt` is within `preflightCacheTTL = 60s` and status is ok/recovered/recreated, **skip slow checks** (env, PATH, workdir).
7. Otherwise run `internal/health.Checker` (env vars, PATH binaries, workdir existence). On failure, surface to user; on recovery, stamp `LastHealthStatus="recovered"`.
8. If tmux pane is dead but `sess.UUID` exists, recreate via `claude --resume UUID` (preserves chat history). Stamp `LastHealthStatus="recreated"`.
9. `createAndAttach` (when called fresh): `filepath.Abs(workdir)` → `session.Yolo(SpawnOpts{...})` (in `internal/session/spawn.go`).
10. `internal/session/spawn.go:Yolo` — `claude.BuildCommand(uuid, "yolo", false, overlayPath, envFilePath)` returns the shell-command string with overlay/env-file gates; `tmux.NewSession(name, workdir, shellCmd)` creates the detached pane; `Store.Save(&sess)` persists. On Save failure, kills the orphan tmux session.
11. `cmd/attach.go:createAndAttach` — `store.UpdateAttached(name)`, `fireHook("on_new", &sess)`, `fireServeEvent("session_new" / "session_attached", &sess)`, finally `tc.Go(name)` (= `tmux switch-client` if inside tmux, else `tmux attach-session`).

**Side effects:** writes to `sessions.json`; tmux session created or attached; user's terminal handed over to tmux; serve daemon notified via `POST /api/hooks/:event` (best-effort); user-defined shell hooks executed (best-effort).

**Failure modes:** non-absolute or non-existent workdir → error before any persistence (Yolo precondition). tmux-not-installed → tmux exec returns "not found"; fail-loud at `tc.NewSession`. Save failure post-NewSession → orphan tmux session is killed before returning.

---

## Flow: `ctm yolo [name] [path]` — yolo-mode session with checkpoint

**Trigger:** `ctm yolo`, `ctm yolo myname`, `ctm yolo myname /workdir`, or `ctm yolo!` (force).

**Path through code:**

1. cobra → `cmd/yolo.go:runYolo` (or `runYoloBang` / `runSafe`).
2. `proc.EnsureServeRunning(ctx)` (same as attach).
3. `ensureSetup()` (same as attach).
4. Resolve workdir: explicit `args[1]` → existing session's `Workdir` → tmux pane current path → `os.Getwd()`. (`yolo.go:resolveWorkdir`.)
5. `session.ValidateName(name)`.
6. If `cfg.GitCheckpointBeforeYolo`: `cmd/yolo.go:gitCheckpoint(workdir, out)` — checks `git rev-parse --is-inside-work-tree`; on success runs `git add -A && git commit -m "checkpoint: pre-yolo <ts>" --allow-empty -q`. Errors swallowed.
7. Print ">>> YOLO MODE", fire `on_yolo` user hook, fire `on_yolo` serve event.
8. `shouldResumeExisting(sess, "yolo")` — if true (existing session, mode matches), → `preflight(sess, ...)` (resume path).
9. Else: kill existing tmux, delete from store, `createAndAttach(name, workdir, "yolo", ...)` (continues into the same flow as step 9 of Attach).

**`yolo!` differs:** unconditionally kills existing tmux + deletes from store + creates fresh. Use to recover from a wedged session.

**Side effects:** new git commit on the workdir's HEAD (rolling-back: `git reset --hard HEAD~1`). New session entry in `sessions.json`. New tmux session running `claude --session-id <uuid> --dangerously-skip-permissions`. Hook + event fanouts.

**Failure modes:** non-git workdir silently skips checkpoint. Invalid name → early error. tmux exec failure → orphan cleanup attempted.

---

## Flow: HTTP `POST /api/sessions` (UI "New Session")

**Trigger:** Browser POSTs `{"name":"...", "workdir":"...", "mode":"yolo|safe", "initial_prompt":"..."}` to `127.0.0.1:37778/api/sessions` with Bearer token.

**Path through code:**

1. `internal/serve/server.go:registerRoutes` — `mux.Handle("POST /api/sessions", authHF(api.RequireOriginFunc(allowedOrigins, api.CreateSession(...))))`.
2. **authHF middleware:** `api.BearerFromRequest(r)` extracts `Authorization: Bearer <tok>` (or query param fallback for SSE) → `s.sessions.Lookup(tok)` → on miss, 401 `{"error":"invalid_token"}`. On hit, `r.WithContext(auth.WithUser(ctx, user))`.
3. **RequireOriginFunc:** validates `Origin` header against `allowedOrigins` (loopback pair + `CTM_ALLOWED_ORIGINS` env + `~/.config/ctm/allowed_origins` file). On mismatch: 403.
4. `internal/serve/api/sessions_proj_create.go:CreateSession` (handler factory) — decodes JSON body, validates name + workdir, looks up `claude` via `execLookPath{}`, checks the projection for an existing session with that name → 409 if collision.
5. `internal/session/spawn.go:Yolo` — same shared spawn helper used by the CLI. Creates tmux session detached, persists to `sessions.json`. The daemon **does not attach**.
6. Optional initial-prompt forwarding: if request body had `initial_prompt`, `tmux send-keys` it after `pane_ready.go` confirms readiness.
7. Publish `session_new` + `session_attached` events to `events.Hub`. SSE subscribers (the requesting browser plus any other clients) receive the events on `/events/all`.
8. Return `{"name":"...", "uuid":"...", "mode":"...", "workdir":"...", "created_at":"..."}` JSON.

**Side effects:** new tmux session, new `sessions.json` entry, hub events published. NO automatic attach.

**Failure modes:** auth 401, origin 403, name-validation 400, workdir-stat 400, name collision 409, claude-not-on-PATH 500, tmux-exec 500.

---

## Flow: Tool-call ingest → SSE → UI

**Trigger:** Claude calls a tool inside a ctm-spawned session. The `PostToolUse` hook (wired by `cmd/overlay.go:buildSampleOverlay`) invokes `<ctm-binary> log-tool-use` with the hook payload on stdin.

**Path through code:**

1. `cmd/log_tool_use.go:runLogToolUse` — reads stdin (capped at 1 MiB), parses JSON, sanitizes session id via `sanitizeSessionID` (regex `[^a-zA-Z0-9_-]`), opens `~/.config/ctm/logs/<uuid>.jsonl` with O_APPEND|O_CREATE, takes an exclusive flock, appends one line `{"ts":..., ...payload}`. Always exits 0 (hooks must not block tools).
2. **Daemon side:** `internal/serve/ingest/tailer.go` — per-session `Tailer` opens the same JSONL file, reads new lines from a persisted offset, parses via `tailer_parse.go`, publishes typed `tool_call` events to `events.Hub`.
3. **Cost subscriber:** `internal/serve/store/SubscribeQuotaWriter` — receives quota triples and inserts batched rows into the `cost_rows` SQLite table.
4. **FTS subscriber:** subscribes to tool-call events and inserts into `tool_calls_fts`. Wiped on boot, repopulated by tailer's offset-0 replay. (`internal/serve/server.go:325` "V19 slice 3 FTS subscriber".)
5. **SSE delivery:** `internal/serve/events/handler.go:Handler(hub, sessionFilter)` — subscribes to the hub with the URL path's session filter (or `""` for all), writes `data:` lines + `id:` lines as events arrive. Honors `Last-Event-ID` request header for replay.
6. **UI:** `ui/src/components/SseProvider.tsx` opens `/events/all` via `@microsoft/fetch-event-source` (header-aware, unlike native EventSource). On message, dispatches into TanStack Query cache invalidations or component-local state. The `<FeedStream>` component renders the live feed.

**Side effects:** JSONL append (size+age+count rotated); SQLite insert (cost_rows + tool_calls_fts); hub event broadcast to all subscribers.

**Failure modes:** stdin malformed → `runLogToolUse` writes nothing, exits 0. JSONL too big → `logrotate.MaybeRotate` invoked from log-tool-use path `[inferred — verify via grep -n MaybeRotate cmd/log_tool_use.go]`. SQLite locked or full → individual row inserts log WARN; daemon continues. SSE client drops → hub Subscribe returns; reconnect resumes from `Last-Event-ID`.

---

## Don't-fix-these patterns visible in these flows

- `ensureSetup` is called from many CLI commands every run. Don't memoize globally — file presence checks are cheap, and idempotency is the whole point.
- `proc.EnsureServeRunning` hardcodes `127.0.0.1:37778` instead of importing `internal/serve.DefaultPort` to avoid pulling the daemon's transitive imports into every CLI binary call site. Keep it that way unless the duplication actually breaks something. (`internal/serve/proc/spawn.go:29-31`.)
- `BuildCommand`'s `||` fallback is intentionally aggressive (catches non-zero on any reason, not just "session not found"). Comment in `internal/claude/command.go` explains.
