# Key Flows

Three flows worth tracing end-to-end. Trigger → file:line path → side effects → failure modes.

---

## Flow: `ctm yolo myproj` — create-or-attach a YOLO session

**Trigger:** User runs `ctm yolo [name]` from terminal.

**Path through code:**

1. `cmd/yolo.go:runYolo` — entry. Calls `proc.EnsureServeRunning(ctx)` first (auto-spawn daemon if missing).
2. `cmd/yolo.go:~50` (sampled) — loads config, opens session store, opens tmux client.
3. `cmd/yolo.go:shouldResumeExisting` — if a session with that name already exists in mode=yolo, takes the preflight branch (reattach). Mode change drops tmux + store row to mint a fresh UUID.
4. `cmd/yolo.go:createAndAttach` (and the lifted `internal/session/spawn.Yolo` for the daemon path) —
   - Validates workdir is absolute and is a directory.
   - Builds claude command via `internal/claude/command.go:BuildCommand(uuid, "yolo", false, overlayPath, envFilePath)` — sets `--dangerously-skip-permissions` for yolo mode, layers `--settings <overlay>`, sources `env.sh`.
   - `tmux.NewSession(name, workdir, shellCmd)` — creates detached tmux session.
   - `session.Store.Save(...)` — writes `sessions.json` row with `Mode: "yolo"`.
   - If `git_checkpoint_before_yolo` is true, an auto-checkpoint commit is created in the workdir before claude bypasses permissions.
5. `tmux switch-client` / `tmux attach` — user's terminal joins the session.

**Side effects:**

- `~/.config/ctm/sessions.json` write (atomic + flock).
- `git commit` in workdir (if `git_checkpoint_before_yolo`).
- New tmux session named `<name>` running claude with `--dangerously-skip-permissions`.
- HTTP daemon notified via lifecycle hooks (`on_yolo`, `on_new`).

**Failure modes:**

- Workdir not absolute / not a directory → returns error before touching tmux/store.
- tmux fails → no `Save` is called; no orphan rows.
- `BuildCommand` fallback: `claude --resume UUID || claude --session-id UUID` — recovers cleanly when claude history vanished. The `||` fires on *any* non-zero, including crashes (intentional, per `BuildCommand` docstring).

---

## Flow: `POST /api/auth/login` (V27 cookie session)

**Trigger:** Browser submits login form via `useLogin` hook → `POST /api/auth/login` with JSON `{email, password}`.

**Path through code:**

1. `internal/serve/server.go:633` — `mux.Handle("POST /api/auth/login", api.RequireOriginFunc(allowedOrigins, api.AuthLogin(s.sessions, loginLimiter)))`. Origin allowlist + rate limit applied before handler.
2. `internal/serve/auth/ratelimit.go` — `loginLimiter`: 5 attempts / 60s per IP. 429 on overflow (`5bf02d3 feat(auth): rate-limit /api/auth/login`).
3. `internal/serve/api/auth.go:AuthLogin` (sampled — file is 241 LOC, not fully read) — decodes body, loads `user.json` via `auth.LoadUser`, `auth.Verify(enc, password)` (constant-time argon2id verify).
4. On success: `auth.Sessions.Create(...)` mints in-memory token (30-day TTL); `Set-Cookie` written to response.
5. UI's `AuthProvider` reacts: `useAuthStatus` re-fetches, transitions render path.

**Side effects:**

- In-memory entry in `auth.Sessions` (lost on daemon restart).
- `Set-Cookie` header on response.
- Failed attempt count incremented per-IP in `ratelimit`.

**Failure modes:**

- Bad password → 401 inline (UI surfaces in form).
- User not configured → 404 (UI nudges to signup).
- Origin not in allowlist → 403 from `RequireOriginFunc`.
- Rate limit exceeded → 429.
- Daemon restart → all sessions invalidated; user re-logs.

---

## Flow: Tool-use ingest → SSE fan-out → UI feed

**Trigger:** Claude executes a tool call inside a tmux session → PostToolUse hook posts a JSON line to `POST /api/hooks/{event}`.

**Path through code:**

1. CLI hook command: `ctm log-tool-use` (`cmd/log_tool_use.go:124`) appends to `~/.config/ctm/logs/<session-id>.jsonl` (0600). Rotation via `internal/logrotate`.
2. Hook also posts to daemon: `internal/serve/server.go:552` — `mux.Handle("POST /api/hooks/{event}", api.Hooks(s.tailers, s.hub))`. NOT auth-gated (loopback, called by hook on the same machine).
3. `internal/serve/api/hooks.go` (`[inferred]` from route registration; not fully sampled) — parses event, hands to tailers + hub.
4. **Tailers** (in `internal/serve/store/`) write to SQLite: `IndexToolCall` to `tool_calls_fts`, cost row to `cost_points`.
5. **Hub** publishes the event to subscribers. Ring buffer holds recent events for late joiners.
6. **Attention engine** (`internal/serve/attention/engine.go`) sees the event via `SessionSource` — re-evaluates triggers A (last call `is_error`) and B (error rate >20%).
7. SSE clients on `GET /events/all` and `GET /events/session/{name}` (server.go:664–665) receive the event.
8. UI `<SseProvider>` + `useFeed` / `useEventStream` push into the feed. `<FeedStream>` component renders. `<ToolCallRow>` collapses; click expands via `useToolCallDetail` → `GET /api/sessions/{name}/tool-call/{id}` (`tool_call_detail.go`, 497 LOC).

**Side effects:**

- Append-only JSONL file write.
- Two SQLite inserts (cost + FTS).
- Hub broadcast (in-memory).
- Possible attention state transition + outbound webhook POST (if user-configured).

**Failure modes:**

- Hook timeout → claude continues; line lost from daemon view but still in JSONL on disk (replay on restart).
- SQLite locked → writes serialized via `s.mu`; closed-store check prevents post-shutdown writes.
- SSE client disconnects → hub drops subscriber; ring buffer lets reconnect resume from last seen ID `[inferred]` (typical for SSE — verify in `events/sse.go`).
- Webhook failure → fire-and-forget per spec; not retried.
