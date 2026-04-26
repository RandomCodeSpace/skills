# Data Model

ctm has no relational database server. State lives in three places: schema-versioned JSON files under `~/.config/ctm/`, a SQLite (FTS5) file for tool-use cost + search, and per-session JSONL append logs.

## Storage

- **Primary structured state:** JSON files under `~/.config/ctm/`, atomic-write + flock. Defined in `internal/config/config.go` and `internal/session/state.go`.
- **Search/cost store:** SQLite at `~/.config/ctm/cost.db`. Schema in `internal/serve/store/cost_store.go`. Requires `-tags sqlite_fts5` at build time.
- **Tool-use logs:** `~/.config/ctm/logs/<session-id>.jsonl` (0600). Rotation via `internal/logrotate`.
- **Migrations:** `internal/migrate` runner. No external migration tool. Per-file `MigrationPlan` defined where the file's schema lives (e.g. `internal/session/state.go MigrationPlan()`).

## Entities

### `Config` (persisted as `config.json`)

- **Defined in:** `internal/config/config.go`
- **File path:** `config.ConfigPath()` → `~/.config/ctm/config.json`
- **Key fields (sampled grep):**
  - `schema_version` (int) — required for migrator
  - `git_checkpoint_before_yolo` (bool)
  - `yolo_unchecked_minutes` (int) — feeds attention trigger G
  - `Hooks` map → lifecycle event names (`on_attach`, `on_new`, `on_yolo`, `on_safe`, `on_kill`)
  - `RequiredEnv`, `RequiredInPath` — preflight inputs
  - `Serve` sub-struct (webhook URL/auth + attention thresholds for triggers B/C/E/F/G)
- **Permissions:** 0600 (personal-pref state).

### `Sessions` (persisted as `sessions.json`)

- **Defined in:** `internal/session/state.go`
- **File path:** `config.SessionsPath()` → `~/.config/ctm/sessions.json`
- **Shape:** map keyed by session name → `Session`.
- **`Session` fields (sampled `internal/session/spawn.go`):** `Name`, `Workdir` (must be absolute), `Mode` (`safe` | `yolo`), plus UUID + timestamps `[inferred]` from naming convention.
- **Invariants:**
  - Workdir must exist and be a directory — `Yolo()` enforces.
  - Atomic write + flock (`internal/session/state.go`).
  - Backup at `sessions.json.bak.<timestamp>` before every destructive migration.

### `User` (persisted as `user.json`, V27)

- **Defined in:** `internal/serve/auth/user.go`
- **File path:** `~/.config/ctm/user.json` `[inferred]` from `auth.user.go` shape; verify via `grep AllowedOriginsPath\|UserPath` in `internal/config/config.go`.
- **Fields:** email (treated as username), argon2id `Encoded` password (`Algo`, `Salt`, `Hash`, params `T,M,P,HashLen`).

### Sessions table (in-memory hub)

- **Defined in:** `internal/serve/auth/sessions.go` (160 LOC)
- **Storage:** in-memory map; not persisted across daemon restarts.
- **TTL:** 30 days (`b973d7a feat(auth): 30-day TTL on in-memory sessions`).
- **Cookie:** session token; details in `auth/sessions.go` `[inferred]` from filename — verify via grep.

### SQLite tables

Defined in `internal/serve/store/cost_store.go` (verified via grep):

- `cost_points(session, ts, ...)` — token / cost time series. Indexed on `(session, ts)`.
- `tool_calls_fts USING fts5(...)` — FTS5 virtual table backing `/api/search` `[inferred]` and `internal/serve/store/search_store.go`'s `IndexToolCall` / `SearchFTS`.
- `schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)` — schema version cell.

**Idempotency:** `OpenCostStore` wipes the FTS table on boot; the tailer's offset-0 replay repopulates it. The replay model means restart is always safe.

## Relationships overview

There are no foreign keys. Loose coupling by `session-name`:

- `sessions.json` row name === tmux session name === keys into `cost_points.session` and `tool_calls_fts.session` and the on-disk `<session-uuid>.jsonl` log path.
- `claude-overlay.json` is global, not per-session.
- `allowed_origins` (one Origin per line) governs all mutation endpoints.

## Lifecycle / state machines

### Session mode

`safe ⇄ yolo` — explicit mode change forces a fresh tmux session + UUID via `KillSession` + `Delete`. Same-mode reattach goes through `preflight()` which can recreate from `--session-id UUID` if claude has exited. See `cmd/yolo.go` `runYolo` (sampled).

### Attention state (per session)

`StateClear → (TriggerA|...|TriggerG)`. Engine in `internal/serve/attention/engine.go`. A single highest-priority trigger wins; ticker re-evaluates time-based triggers (C, G). Triggers locked at A–G — see spec §1.

## Schema source of truth

- **`config.json` schema:** `internal/config/config.go` `Config` struct + `MigrationPlan()` const.
- **`sessions.json` schema:** `internal/session/state.go` `Session` + `MigrationPlan()`.
- **SQLite schema:** `internal/serve/store/cost_store.go` (the `CREATE TABLE` strings are the source — there's no SQL file).
- **Migrations:** `internal/migrate` orchestrates; no separate `migrations/` directory.

When evolving any schema: bump `SchemaVersion`, append a `Step` to `MigrationPlan()`, and add a unit test under the same package's `*_test.go`.
