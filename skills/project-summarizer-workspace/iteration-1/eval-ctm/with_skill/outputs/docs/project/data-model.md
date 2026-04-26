# Data Model

ctm has no relational schema in the conventional sense. Most state is JSON files written atomically; a single SQLite database holds derived/append-only data that needs FTS or efficient time-series queries. There are no migration files in the SQL sense — the JSON files use a `schema_version` integer and a Go-side migrator (`internal/migrate/`).

## Storage

| Store | Path | Format | Owner | Purpose |
|-------|------|--------|-------|---------|
| Main config | `~/.config/ctm/config.json` | JSON | `internal/config` | User config: hooks map, hook timeout, log policy, `serve` sub-block (port, bearer token, webhook URL/auth, attention thresholds, statusline dump dir). `schema_version` at top level. |
| Sessions | `~/.config/ctm/sessions.json` | JSON | `internal/session` | Map/list of `Session` records (name, UUID, workdir, mode, last health timestamp+status, attached-at). `schema_version` at top level. |
| Single user | `~/.config/ctm/user.json` | JSON, 0600 | `internal/serve/auth` | Credentials for the single-user daemon: `{username, algo, params, salt_b64, hash_b64, created_at}` (see `internal/serve/auth/user.go`). |
| Tool-use logs | `~/.config/ctm/logs/<session>.jsonl` (+ `*.gz` rotated siblings) | JSONL, 0600 | `internal/logrotate` + `cmd/log_tool_use.go` | One line per Claude Code tool invocation. Written by the PostToolUse hook. Rotated by size (default 50 MiB) / age (30d) / count (10). |
| SQLite | `~/.config/ctm/ctm.db` | SQLite (WAL, FTS5) | `internal/serve/store` | Cost history (`cost_store.go`), full-text search (`search_store.go`). Opened in `internal/serve/server.go` via `store.OpenCostStore`. |
| tmux conf | path returned by `config.TmuxConfPath()` | tmux config | `internal/tmux/config.go` | ctm-managed tmux config (e.g. `set-clipboard on`). |
| Claude overlay | path returned by `config.ClaudeOverlayPath()` | JSON | `cmd/overlay.go`, `internal/claude` | Optional sidecar `claude-overlay.json` passed via `claude --settings <path>`. Adds statusline / hooks without touching `~/.claude/settings.json`. Path verified via `OverlayPathIfExists`. |
| Env file | path returned by `config.EnvFilePath()` | shell-sourceable | `internal/claude/command.go` | Optional `env.sh` sourced before claude starts. Quoting/sandboxing already hardened (`docs/robustness-audit.md` row 5). |
| Statusline dumps | `/tmp/ctm-statusline/` (default; overridable via `serve.statusline_dump_dir`) | JSON per session | `cmd/statusline.go` (writes), `internal/serve/ingest/quota.go` (reads) | Per-session token/quota/context snapshots emitted by claude's statusline hook. Watched by `QuotaIngester`. |
| Backups | `<path>.bak.<unix-nano>` | JSON | `internal/migrate` | Snapshot taken before any destructive migration write. `README.md` "State file versioning". |

**Migration tool:** None of the standard names (Flyway, Alembic, sqlx, Prisma) — instead, `internal/migrate/` runs Go-coded migration steps gated by `schema_version` on every startup. A newer-than-known `schema_version` causes a hard refusal to start (`README.md` Configuration > State file versioning).

## Entities

### Config (`internal/config/config.go`)

- **Defined in:** `internal/config/config.go`
- **Backing file:** `~/.config/ctm/config.json`
- **Key fields (verified):**
  - `Hooks map[string]string` `[inferred from cmd/hooks_dispatch.go: cfg.Hooks]` — event → shell command.
  - `HookTimeoutSec int` (json: `hook_timeout_seconds`) — zero falls back to 5s default via `HookTimeout()`.
  - `Serve ServeConfig` (json: `serve`) — daemon block.
  - `DefaultMode` `[inferred — referenced as cfg.DefaultMode in cmd/attach.go:79]`.
  - Log rotation knobs: `log_max_size_mb` (default 50), `log_max_age_days` (default 30), `log_max_files` (default 10) — `README.md` Logs > Rotation.
  - Top-level `schema_version: int` — used by the migrator.
- **Invariants:** Strict-decode (jsonstrict.DisallowUnknownFields); zero-valued numeric fields resolve to defaults via `Resolved()` helpers (so old configs continue to work after schema bumps that add fields).

### ServeConfig (`internal/config/config.go`)

- **Defined in:** `internal/config/config.go` (~line 70-110 area `[inferred]`)
- **Key fields:**
  - `Port int` (json: `port`) — default `DefaultServePort = 37778`.
  - `BearerToken string` (json: `bearer_token`) `[inferred — present in struct but not actively used; auth model is now session-cookie via auth.Store]`.
  - `WebhookURL string` (json: `webhook_url`) — empty disables outbound webhook.
  - `WebhookAuth string` (json: `webhook_auth`) — sent verbatim in `Authorization` header on each POST.
  - `StatuslineDumpDir string` (json: `statusline_dump_dir`) — default `/tmp/ctm-statusline`.
  - `Attention AttentionThresholds` (json: `attention`).

### AttentionThresholds (`internal/config/config.go`)

- **Defined in:** `internal/config/config.go`
- **Backing config block:** `serve.attention` in `config.json`
- **Key fields (all int, all zero → default via `Resolved()`):**
  - `ErrorRatePct` — default 20
  - `ErrorRateWindow` — default 20
  - `IdleMinutes` — default 5
  - `QuotaPct` — default 85
  - `ContextPct` — default 90
  - `YoloUncheckedMinutes` — default 30
- **Used by:** `internal/serve/attention/Engine` (mapped via `cmd/serve.go:attentionThresholdsFrom`).

### Session (`internal/session/session.go`)

- **Defined in:** `internal/session/`
- **Backing file:** `~/.config/ctm/sessions.json`
- **Key fields (verified from caller usage):**
  - `Name string` — tmux-session name; validated by `session.ValidateName` (`cmd/attach.go:48`).
  - `UUID string` — Claude Code session UUID; passed to `claude --resume UUID` (READMe Features).
  - `Workdir string`
  - `Mode string` — operating mode (`yolo` / `safe` / default — `[inferred from cmd/yolo.go]`).
  - `LastHealthAt time.Time` — used by `healthCacheValid` (`cmd/attach.go:34`) for the 60s preflight cache.
  - `LastHealthStatus string` — `"ok"` / `"recovered"` / `"recreated"` are the cache-valid statuses (`cmd/attach.go:39`).
- **Invariants:**
  - Atomic writes (tmpfile + rename) and advisory `flock` (`README.md` Features).
  - Self-healing strict JSON decode: on parse failure, the file is moved to `<path>.bak` and a fresh empty store is created (`README.md` Features).
  - `schema_version` enforced on read.

### User (`internal/serve/auth/user.go`)

- **Defined in:** `internal/serve/auth/user.go`
- **Backing file:** `~/.config/ctm/user.json` (0600)
- **In-memory shape:**
  - `Username string`
  - `Password Encoded` (json:"-" — flattened on persist)
  - `CreatedAt time.Time`
- **On-disk shape (`userPersisted`):** `{username, algo, params, salt_b64, hash_b64, created_at}`.
- **Single-instance:** Exactly one user record. `Exists()` reports presence; `Save()` is the only writer (atomic tmp+rename, mkdir 0700, file 0600).
- **Algo:** `algo` is a string field (e.g. likely `"argon2id"` `[inferred]`). `golang.org/x/crypto` v0.50.0 is in `go.mod`.

### Tool-use log entry (`cmd/log_tool_use.go`, `internal/serve/ingest/tailer_parse.go`)

- **Defined in:** Implicit JSONL line schema. Each line is the full Claude Code PostToolUse hook payload + a UTC timestamp injected by `cmd/log_tool_use.go` (`README.md` Logs).
- **Key fields (from caller usage):** `tool_name`, plus the original Claude Code payload (free-form JSON). Filterable via `ctm logs --tool` (case-insensitive substring on `tool_name`) and `--grep` (regex on raw JSON).
- **Invariants:**
  - File perms 0600.
  - Session ID sanitized to prevent path traversal (README, line referenced).
  - Concurrent writes coordinated via advisory flock.
  - Read path transparently spans the active log + every rotated `<session>.jsonl.<unix-nano>.gz`.

### Cost history (`internal/serve/store/cost_store.go`)

- **Defined in:** `internal/serve/store/cost_store.go`
- **Backing storage:** SQLite (`~/.config/ctm/ctm.db`) opened with WAL.
- **Purpose (from `server.go` comment):** "persists per-session token/cost history so the dashboard chart survives daemon restarts. WAL mode + batched tx inserts keep the write path off the hub's hot loop."
- **Schema:** Not directly read; the file is `cost_store.go` (no separate migration file). Inspect the file when modifying.
- **Subscriber:** `internal/serve/store/subscriber.go` listens to `Hub` events and writes through.

### Search index (`internal/serve/store/search_store.go`)

- **Backing storage:** SQLite FTS5 in the same `ctm.db`.
- **Purpose:** Full-text search across tool-use logs (V19 — see `docs/v02/V19-search.md`).
- **Build-tag dependency:** `sqlite_fts5` (`Makefile` header). Without it, opening the FTS5 virtual table panics at runtime.

## Relationships overview

There is no FK graph because there is no SQL schema for sessions/config. The de-facto links:

- `Session.UUID` ↔ `<UUID>.jsonl` log file (filename matches the session UUID).
- `Session.Name` ↔ tmux session name (1:1).
- `Session.Workdir` ↔ git checkpoint path used by `internal/serve/git/`.
- `User.Username` ↔ login session token in `internal/serve/auth/sessions.go` (in-memory).

## Lifecycle / state machines

### Session health-check status (`internal/session/Session.LastHealthStatus`)

```
(unset) ──ctm attach──► "ok" ──60s TTL──► (re-check)
                          │
                          └──recovery path──► "recovered" / "recreated"
                                                     │
                                                     └──TTL valid──► (skip slow checks)
```

Cache validity: only `"ok"`, `"recovered"`, `"recreated"` are treated as valid by `healthCacheValid` (`cmd/attach.go:34`). Any other status forces a full preflight.

### Session lifecycle (cmd-side hooks)

```
(no record)        ── ctm attach <new-name> ──► fireHook "on_new"
                                                fireServeEvent "session_new"
                                                fireServeEvent "session_attached"
"existing"         ── ctm attach <name>     ──► fireHook "on_attach"
                                                fireServeEvent "session_attached"
"existing/yolo"    ── ctm yolo <name>        ──► fireHook "on_yolo"
                                                  fireServeEvent "on_yolo"
"existing/safe"    ── ctm safe (yolo --safe?) ──► fireHook "on_safe"
                                                   fireServeEvent "session_attached"
"existing"         ── ctm kill <name>        ──► fireHook "on_kill"
                                                  fireServeEvent "session_killed"
```

(Exact call sites: `cmd/attach.go:97-194`, `cmd/yolo.go:123-234`, `cmd/kill.go:47-82`.)

## Schema source of truth

**Unambiguous mapping:**

| State | Source of truth | Don't trust |
|-------|----------------|-------------|
| `config.json` | The Go `Config` struct in `internal/config/config.go` | README — README is illustrative, struct fields are authoritative |
| `sessions.json` | The Go `Session` struct in `internal/session/` | Any cached snapshot in code comments |
| `user.json` | `userPersisted` struct in `internal/serve/auth/user.go:18` | The exported `User` struct (Password is json:"-" so its on-disk form differs) |
| Tool-use JSONL | The Claude Code PostToolUse payload + a `ctm`-injected UTC timestamp; parser in `internal/serve/ingest/tailer_parse.go` | None — there is no schema doc, so when changing fields, update the parser AND any UI consumers in `ui/src/lib/tools.ts` together |
| SQLite tables | The Go in `internal/serve/store/cost_store.go` and `search_store.go` (CREATE TABLE statements live in those files; verify with grep) | No `schema.sql`, no migrations dir — the Go code is the only source |

**Migration discipline:** Bumping a `schema_version` requires landing a step in `internal/migrate/` *and* exercising it via `internal/migrate` tests. The migrator backs up before destructive writes (`<path>.bak.<unix-nano>`), so failed migrations are recoverable with one `mv`. Refusal-to-start on newer-than-known versions prevents silent downgrade.
