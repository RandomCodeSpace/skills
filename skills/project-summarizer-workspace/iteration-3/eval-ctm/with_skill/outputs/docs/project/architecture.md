# Architecture

## High-level shape

ctm is a single Go binary that does double duty: a tmux-driving CLI for managing long-lived Claude Code sessions, and a long-lived HTTP daemon (`ctm serve`) that ingests session state + tool-use logs and exposes them through a REST + SSE API consumed by an embedded React SPA. The daemon is auto-spawned on first attach/new/yolo and bound to `127.0.0.1:37778`. Storage is local-only: JSON files under `~/.config/ctm/` for session/config state, SQLite (FTS5) for tool-call cost + search history.

In-repo design specs (read these before changing anything load-bearing):
- `docs/superpowers/specs/2026-04-20-ctm-serve-ui-v0.1-design.md` — the daemon + UI architecture, scope, attention triggers A–G.
- `docs/superpowers/specs/2026-04-22-V25-session-input-design.md` — input bar / send-keys flow.
- `docs/superpowers/specs/2026-04-22-V26-create-session-design.md` — `/api/sessions` create from UI.
- `docs/superpowers/specs/2026-04-22-V27-single-user-auth-design.md` — argon2id + cookie session model.
- `docs/v02/V19-search.md`, `V23-mutation-auth.md`, `V7-sparkline.md`, `V3-stale-badge.md` — older slice specs still authoritative for their surfaces.
- `docs/robustness-audit.md` — explicit invariants and known sharp edges.

Don't restate these — link from changes that touch the same surfaces.

## Components

### `cmd/` — Cobra CLI

- **Lives in:** `cmd/`
- **Responsibility:** All user-facing verbs (~30). Each verb is its own file. Wired into `rootCmd` via `func init() { rootCmd.AddCommand(...) }` in each file.
- **Key files:** `root.go` (rootCmd, version resolution), `attach.go` (default RunE), `serve.go` (daemon start), `yolo.go` (296 LOC — most complex CLI verb), `logs.go` (439 LOC — log query with rotation).
- **Talks to:** `internal/{config,session,tmux,health,doctor,serve,claude}` directly via package imports.
- **Owns:** stdout/stderr presentation; nothing persistent.

### `internal/serve/` — HTTP daemon

- **Lives in:** `internal/serve/`
- **Responsibility:** REST + SSE API for the UI. Loopback-only.
- **Key files:** `server.go` (962 LOC — route table, middleware composition, graceful shutdown — sampled `:1–60`, `:460–510`, and route table grep), `dist/` (//go:embed UI bundle target).
- **Sub-packages:**
  - `api/` — handlers, one resource family per file (auth, bootstrap, checkpoints, config, cost, doctor, feed, hooks, list/get sessions, logs_usage, mutations, pane_stream, quota, subagents, teams, tool_call_detail, …). Files end with `_test.go`. Total ~11.1k LOC across `serve/` and `serve/api/` (verified via `wc -l`).
  - `attention/` — implements triggers A–G from the v0.1 spec. Engine in `engine.go`; tests in `engine_test.go` cover each trigger.
  - `auth/` — argon2id `password.go`, in-memory `sessions.go` (30-day TTL), per-IP `ratelimit.go` (5/60s), `middleware.go`, `user.go` (load/save `user.json`).
  - `events/` — `Hub` pub/sub + ring buffer (`hub.go`), `sse.go` SSE handler.
  - `git/` — checkpoint/diff/revert plumbing for the per-workdir `/checkpoints` API.
  - `ingest/` — `sessions_proj.go`: RWMutex-guarded in-memory projection of `sessions.json` (re-read on fsnotify + interval).
  - `proc/` — `EnsureServeRunning`: probes `/healthz` for `X-Ctm-Serve` header to decide whether to spawn a sibling daemon.
  - `store/` — SQLite + FTS5 (`cost_store.go`, `search_store.go`).
  - `webhook/` — outbound POST on attention transitions (HMAC-signed [inferred]).
- **Talks to:** filesystem (`~/.config/ctm/`), tmux via `internal/tmux`, git via `os/exec`. No outbound HTTP except user-configured webhook.
- **Owns:** SQLite at `~/.config/ctm/cost.db`, in-memory hub, sessions projection, attention engine state.

### `cmd/yolo.go` + `internal/session/spawn.go` — session lifecycle

- **Responsibility:** Create/reattach tmux session running claude in either `safe` (default) or `yolo` (permissions-bypassed) mode. `internal/session/spawn.Yolo` was lifted out of `cmd/yolo.go` (V26) so the daemon's `POST /api/sessions` shares the path.
- **Owns:** tmux session naming/lifecycle, claude command construction (via `internal/claude.BuildCommand`), `sessions.json` rows.

### `ui/` — React 19 SPA

- **Lives in:** `ui/` (rsync'd into `internal/serve/dist/` at build).
- **Responsibility:** Mobile-first session dashboard. Routes deep-linkable. Two-pane on ≥768px.
- **Key files:** `src/App.tsx` (router + provider stack), `src/routes/Dashboard.tsx`, `src/routes/SessionDetail.tsx`, `src/components/SseProvider.tsx`, `src/components/AuthProvider.tsx`, `src/components/AuthGate.tsx`. ~25 hooks under `src/hooks/` map 1:1 to API endpoints.
- **Talks to:** daemon via TanStack Query (`/api/*`) and SSE (`/events/*`).
- **Owns:** session-token cookie; QueryClient cache (30s staleTime).

## Layering / dependency rules

Enforced by Go's `internal/` rule:

- `cmd/*` may import `internal/*`. Nothing imports `cmd/*`.
- `internal/serve/*` may import `internal/{config,session,tmux,claude,jsonstrict,...}`. The reverse is forbidden — no leaf `internal/<x>/` package may import `internal/serve/`.
- `internal/serve/api/*` is the only place that owns HTTP request/response shapes. Handlers compose dependencies via narrow interfaces (e.g. `SessionEnricher`, `TmuxSpawner`, `Saver`) declared at the consumer side.
- Route registration lives **only** in `internal/serve/server.go`. Handler files export factory funcs; they do not call `mux.Handle`.

## Cross-cutting concerns

- **Logging:** `log/slog` via `internal/logging.Setup`. CLI defaults info; `--verbose` / `--log-level=debug`. Set `CTM_LOG_FORMAT=json` for NDJSON. Configured in `cmd/root.go` `PersistentPreRunE`.
- **Error handling:** Errors flow up as values; CLI handlers return `error` from `RunE` and Cobra prints + non-zero exits. HTTP handlers return JSON envelopes; auth/origin errors are 401/403 plain. No panics — `internal/jsonstrict` self-heals corrupted JSON via `.bak` rotation.
- **Auth / authz:** All `/api/*` (except `/api/auth/*` status/login/signup) gated by cookie session via `authHF`. Mutation endpoints additionally require `Origin` allowlist via `api.RequireOriginFunc`. Loopback-only bind is the outer perimeter.
- **Observability:** `/healthz` (open, version header) and `/health` (auth) endpoints. `/debug/hub` exposes hub stats. Tool-use lines appended to `~/.config/ctm/logs/<session-id>.jsonl` (0600).
- **Config:** `internal/config.Load(path)` reads `~/.config/ctm/config.json`. Schema-versioned; `internal/migrate` runs on every startup and stamps the new version atomically.

## Why it's shaped this way

- **Single binary with embedded UI** — air-gapped install, single `go install` step. The Makefile-mandated `rsync` into `internal/serve/dist/` exists because `//go:embed` rejects parent paths.
- **Loopback bind, cookie + Origin allowlist** — the project explicitly avoids being a remote-accessible service. Reverse-proxying requires opt-in via `CTM_ALLOWED_ORIGINS` / `~/.config/ctm/allowed_origins`.
- **In-process Hub** — the v0.1 design rejected an external broker. All tool-use → ingest → fan-out happens in one Go process. See spec §2 architecture diagram.
- **Triggers A–G are locked** — the spec calls them out as "locked" so the next agent does not invent an H.
