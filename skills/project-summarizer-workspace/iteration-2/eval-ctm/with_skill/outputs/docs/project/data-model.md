# Data Model

## Storage

ctm has **three** persistence layers, each with a distinct contract:

1. **JSON state files** — source of truth for config + session metadata. Versioned + flock-locked + atomically written.
2. **JSONL tool-call logs** — append-only log of every Claude tool invocation, written by the `ctm log-tool-use` PostToolUse hook.
3. **SQLite** — derived index for cost history + FTS5 full-text search. Wiped + rebuilt on daemon boot from the JSONL logs.

Locations are all under `~/.config/ctm/` (path computed in `internal/config/config.go:Dir`).

| File / dir | Owner | Purpose |
|---|---|---|
| `~/.config/ctm/config.json` | `internal/config` | User preferences (modes, thresholds, webhook). Schema v1. |
| `~/.config/ctm/sessions.json` | `internal/session` | Live session catalog (name → metadata). Schema v0/v1 `[inferred — see below]`. |
| `~/.config/ctm/tmux.conf` | `internal/tmux` | Generated on every `ensureSetup`. Not user-edited. |
| `~/.config/ctm/claude-overlay.json` | (user-managed) | Optional. Layered onto claude via `--settings`. |
| `~/.config/ctm/env.sh` | (user-managed) | Optional. Sourced before claude exec. |
| `~/.config/ctm/allowed_origins` | `internal/config.AllowedOriginsPath` | One-origin-per-line CSRF allowlist for `ctm serve`. |
| `~/.config/ctm/logs/<claude-uuid>.jsonl` | `cmd/log_tool_use.go` | One JSONL row per tool call. Rotated by `internal/logrotate`. |
| `~/.config/ctm/ctm.db` | `internal/serve/store` | SQLite (WAL): cost rows + `tool_calls_fts` (FTS5). |
| `<dump-dir>/<claude-uuid>.json` | `cmd/statusline.go` | Per-session statusline payload dumped for `serve` to ingest. Default `/tmp/ctm-statusline`. |

**Migration tool:** `internal/migrate/migrate.go` (custom; no Goose / Flyway / sqlx-migrate). Each JSON state file declares a `Plan` (`internal/config.MigrationPlan` for `config.json`; the sessions equivalent lives alongside `internal/session/state.go` `[inferred — verify via `grep -n MigrationPlan internal/session/`]`). The runner:

- Reads the file's `schema_version` (0 if absent, -1 if the file doesn't exist).
- Refuses to run if `schema_version > CurrentVersion` (downgrade guard).
- Applies `Steps[i]` in order; a `nil` Step is a no-op (used for v0→v1 stamp-only).
- Writes `<path>.bak.<unix-nano>` before the destructive write.
- Stamps the new version, marshals atomically.

## Entities

### Config (`config.json`)

- **Defined in:** `internal/config/config.go`
- **Schema version:** v1 (`SchemaVersion` constant). v0→v1 migration is stamp-only.
- **Top-level fields** (verbatim JSON tags, see `Config` struct):
  - `schema_version` — int. Stamped by migrator; callers never set.
  - `required_env`, `required_in_path` — `[]string`. Pre-flight checks.
  - `scrollback_lines` — int. Tmux scrollback override.
  - `default_mode` — `"yolo"|"safe"`.
  - `git_checkpoint_before_yolo` — bool.
  - `health_check_timeout_sec` — int (seconds).
  - `log_max_size_mb`, `log_max_age_days`, `log_max_files` — int. JSONL log rotation.
  - `hook_timeout_seconds` — int.
  - `hooks` — `map[string]string` (event name → shell command).
  - `serve` — `ServeConfig` (Port, BearerToken, WebhookURL, WebhookAuth, StatuslineDumpDir, Attention).
  - `serve.attention` — `AttentionThresholds` (ErrorRatePct, ErrorRateWindow, IdleMinutes, QuotaPct, ContextPct, YoloUncheckedMinutes).
- **Invariants:**
  - Strict decode: unknown top-level keys trigger one-shot self-heal then become hard errors.
  - Zero-valued optional fields fall back to constants via `LogPolicy()`, `HookTimeout()`, `ResolvedPort()`, `Resolved()` (on `AttentionThresholds`). This is the "old configs keep working" mechanism — DO NOT remove the resolver methods.
- **Schema source of truth:** `internal/config/config.go` Go struct. The migration `Plan` is in the same file. There is no separate `schema.json`.

### Session (`sessions.json`)

- **Defined in:** `internal/session/state.go` (Session struct lives here, not in a `session.go` file — there is none).
- **On-disk shape:** `diskData` struct → `{"schema_version": int, "sessions": map[string]*Session}`.
- **Per-session fields** (verbatim JSON tags from `Session` struct):
  - `name` — string. Validated by `ValidateName` against `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$`.
  - `uuid` — string. RFC 4122 v4 (`internal/session/uuid.go:newUUIDv4`). Test `TestNewUUIDv4Format` enforces format; `TestNewUUIDv4Uniqueness` covers collision.
  - `mode` — `"yolo"|"safe"`.
  - `workdir` — string. **Must be absolute** (enforced by `Yolo` in `spawn.go`).
  - `created_at` — RFC3339 UTC.
  - `last_attached_at` — RFC3339 UTC, omitempty. Updated by `Store.UpdateAttached`.
  - `last_health_status` — `"ok"|"recovered"|"recreated"|<failure>`, omitempty.
  - `last_health_at` — RFC3339 UTC, omitempty.
- **Invariants:**
  - `Workdir` must be absolute and exist as a directory. Enforced in `internal/session/spawn.go:Yolo`.
  - On Save failure after a tmux NewSession succeeds, `Yolo` best-effort kills the orphan tmux session (`spawn.go` end of `Yolo`).
  - The `last_health_*` fields drive the 60-second `preflightCacheTTL` skip in `cmd/attach.go:healthCacheValid`.
- **Concurrency:** flock(2)-style locking on the file before read-modify-write (`internal/session/state.go` `[inferred from import of "syscall" + presence of state_property_test.go]`. Verify via `grep -n syscall internal/session/state.go`).

### TokenUsage / Quota (in-memory; SSE-published)

- **Defined in:** `internal/serve/api/sessions.go` (`TokenUsage`) and `internal/serve/ingest/quota.go`.
- **Source:** Claude statusline payload → dumped to disk by `cmd/statusline.go` when `CTM_STATUSLINE_DUMP` is set → tailed by `QuotaIngester` in `internal/serve/ingest/quota.go`.
- **Snapshot fields:** `WeeklyPct`, `FiveHourPct`, `WeeklyResetsAt`, `FiveHourResetsAt`, `InputTokens`, `OutputTokens`, `CacheTokens`, `ContextPct`. Per-session and global.

### Tool call (event)

- **Defined in:** `internal/serve/ingest/tailer_parse.go` (event struct) `[inferred — one of tailer.go/tailer_parse.go]`.
- **Backing log:** `~/.config/ctm/logs/<claude-uuid>.jsonl`. One JSONL line per call. Written by `cmd/log_tool_use.go:runLogToolUse` from the `PostToolUse` hook.
- **Indexed into:** `tool_calls_fts` (SQLite FTS5 virtual table; `internal/serve/store/cost_store.go:138`). FTS5 quoting is done via `fts5QuotePhrase` in `search_store.go:142` — caller queries are wrapped as literal phrases (embedded `"` doubled).

### Cost row

- **Defined in:** `internal/serve/store/cost_store.go`.
- **Backing table:** `cost_rows` `[inferred — see SQL DDL in cost_store.go for exact name]`.
- **Lifecycle:** Inserted by the `SubscribeQuotaWriter` goroutine started in `internal/serve/server.go:Run`. Batched inserts on a transaction.
- **Wipe-on-boot:** the FTS5 portion is dropped + recreated on `OpenCostStore` so the JSONL replay rebuilds it deterministically. The cost-row history persists across restarts.

### Auth user / session token

- **Defined in:** `internal/serve/auth/user.go`, `internal/serve/auth/sessions.go`.
- **Backing store:** in-memory `auth.Store` with bcrypt-hashed credentials. `[inferred to be non-persistent — verify via `grep -n 'sqlite\\|file\\|os.Open' internal/serve/auth/`]`.
- **Token shape:** opaque bearer string in `Authorization: Bearer <tok>` (REST) or `Authorization` query param (SSE workaround). Sent from the UI's localStorage `ctm.token`.

## Relationships overview

- One `Session` ↔ one tmux session (by `name`).
- One `Session.UUID` ↔ N JSONL rows in `logs/<uuid>.jsonl` ↔ N rows in `tool_calls_fts`.
- One `Session.UUID` ↔ N quota dumps in `<StatuslineDumpDir>/<uuid>.json` ↔ one in-memory `PerSessionSnapshot`.
- `auth.Session` (token) ↔ `auth.User`. No FK to `Session`.

## Lifecycle / state machines

### Session mode transitions

```
                     ctm yolo <name>            ctm safe <name>
                     ───────────►              ───────────►
   (no session) ────► yolo  ───────────────────► safe  ──── ...
                       │                          │
                       │ ctm yolo!                │ ctm yolo
                       ▼                          ▼
                     yolo (fresh UUID)          yolo (fresh UUID)
```

- **Resume vs replace:** `cmd/yolo.go:shouldResumeExisting(sess, requestedMode)` returns true iff `sess != nil && sess.Mode == requestedMode`. When true, `preflight` reattaches (recreating tmux pane via `claude --resume UUID` if needed). When false (mode mismatch or `yolo!`), the existing session is killed + deleted, a fresh UUID is minted.
- **Critical regression guard:** earlier code also required tmux liveness for resume — that caused history loss when claude exited cleanly. Don't re-add. (`cmd/yolo.go:shouldResumeExisting` doc comment.)

### Health-check cache

- A successful health check caches `LastHealthStatus="ok"|"recovered"|"recreated"` + `LastHealthAt`.
- `cmd/attach.go:healthCacheValid` returns true within `preflightCacheTTL = 60 * time.Second`.
- Skip optimization is for SSH-flaky mobile reconnect. Don't extend the TTL without considering staleness on env/PATH changes.

### Migration application

```
file v? read → if v>target ⇒ refuse start
              if v<target ⇒ backup .bak.<ns>, apply Steps[v..target-1], stamp, atomic write
              if v=target ⇒ no-op
```

(`internal/migrate/migrate.go:Run`.)

## Schema source of truth

- `config.json` — Go struct in `internal/config/config.go`. Migration in same file (`MigrationPlan()`).
- `sessions.json` — Go struct + `diskData` in `internal/session/state.go`. Migration plan `[inferred — likely a `MigrationPlan()` next to `state.go`; verify via `grep -rn MigrationPlan internal/session/`]`.
- `ctm.db` — SQL DDL string in `internal/serve/store/cost_store.go` (lines around `:133-140` for the FTS table). Applied on `OpenCostStore`. There is no migration framework; the FTS5 table is `CREATE VIRTUAL TABLE IF NOT EXISTS` and the cost table is similarly `IF NOT EXISTS` `[inferred — patterns visible in survey]`.
- JSONL log row format — defined by `cmd/log_tool_use.go` writer + parsed by `internal/serve/ingest/tailer_parse.go`. **Both must change together** if you alter the line shape.
