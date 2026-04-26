# External Integrations

ctm's "external" surface is unusual: most integrations are with **local binaries** (`tmux`, `claude`, `git`) rather than network services. There are two genuine network egresses (webhook + the user's browser as SSE client) and the daemon's HTTP listener is the single inbound surface.

## tmux (local binary)

- **Purpose:** Persistent terminal multiplexer. ctm's reason to exist — every session lives in a tmux pane so SSH drops are recoverable.
- **Client lives in:** `internal/tmux/client.go` (the `*Client` wrapper) + `internal/tmux/config.go` (generates `~/.config/ctm/tmux.conf`).
- **Auth:** none.
- **Operations used:** `new-session -d`, `kill-session`, `has-session`, `send-keys`, `display-message -p '#{pane_current_path}'`, `switch-client`, `attach-session`, `choose-session`, `set -g`. `[inferred — exact verb list verifiable via `grep -n 'exec.Command.*tmux\\|tmuxExec' internal/tmux/client.go`]`.
- **Failure mode:** binary missing → `cmd/doctor.go` reports `[MISSING]`. Failed tmux exec → command-level error returned; `cmd/yolo.go` and `cmd/attach.go` log a warn and continue when the failure is non-critical (e.g. killing a session that's already dead).
- **Local-dev story:** must be installed on the host. `make dev` does not provide tmux.

## claude (local binary)

- **Purpose:** Anthropic Claude Code CLI. ctm spawns it as the pane process inside each tmux session.
- **Client lives in:** `internal/claude/command.go` builds the shell command line; `internal/claude/process.go`, `internal/claude/tui.go`, `internal/claude/remote_control.go` provide secondary interactions.
- **Auth:** Claude Code handles its own auth (`~/.claude/settings.json`). ctm's overlay at `~/.config/ctm/claude-overlay.json` is layered via `--settings <path>` only when present.
- **Flags ctm passes:**
  - `claude --session-id <uuid>` (fresh) or `claude --resume <uuid>` (with `||` fallback to `--session-id`).
  - `--dangerously-skip-permissions` only when `mode == "yolo"`.
  - `--settings <overlay-path>` when overlay is present (TOCTOU-safe shell `[ -r path ]` guard).
- **Failure mode:** Any non-zero exit from `claude --resume` triggers the `||` fallback to `--session-id` (intentional — see `internal/claude/command.go:BuildCommand` doc).
- **Local-dev story:** must be installed; `cmd/doctor.go` checks it.

## git (local binary)

- **Purpose:** Pre-yolo checkpoint commits + checkpoint listing + revert from the UI.
- **Client lives in:** `cmd/yolo.go:gitCheckpoint` (CLI side); `internal/serve/git/checkpoints.go` + `internal/serve/git/revert.go` (daemon side).
- **Auth:** none.
- **Operations used:** `rev-parse --is-inside-work-tree`, `add -A`, `commit -m "checkpoint: pre-yolo <ts>" --allow-empty -q`, `log` (for checkpoint listing), `reset --hard <sha>`, `stash`, `diff` (for the `/diff` endpoint). `[inferred specific verbs — verify via `grep -n 'exec.Command.*git\\|"git"' internal/serve/git/`]`.
- **Failure mode:** non-git workdir → silently skip checkpoint. `git reset --hard` failures surface to the API as `{"error":"dirty_workdir"}` (see `ui/src/lib/api.ts:RevertDirty`).
- **Cost / quota notes:** `internal/serve/api.CheckpointsCache` 5-second TTL prevents `git log` floods on tick-driven attention checks. Don't bypass.
- **Local-dev story:** must be installed if you want checkpoint/revert features.

## User-configured outbound webhook (HTTP)

- **Purpose:** Push `attention_raised` events (idle session, quota-near-cap, error spike, yolo-unchecked timeout, stale checkpoint) to a user-supplied URL — typically Discord/Slack/n8n.
- **Client lives in:** `internal/serve/webhook/dispatcher.go`.
- **Auth:** Optional `WebhookAuth` header value from `config.Serve.WebhookAuth` — sent verbatim as the `Authorization` header. `[inferred — verify via `grep -n WebhookAuth internal/serve/webhook/dispatcher.go`]`.
- **Endpoints used:** A single `POST <WebhookURL>` with a JSON payload `{session, session_uuid, workdir, mode, alert, state, ...}`.
- **Failure mode:** Retried with exponential backoff (`internal/serve/webhook/dispatcher.go:228` "delivered after retry"). After retries, logged at WARN: "webhook: delivery failed after retries" (line 246). Debounced — same `(session, alert)` within debounce window suppressed (line 168).
- **Cost / quota notes:** none — user-bounded.
- **Local-dev story:** Set `WebhookURL` to `http://localhost:1234` and run `nc -lk 1234` or `ngrok http 1234`. Disabled by default (empty URL → `ErrDisabled`).

## Browser (SSE client)

- **Purpose:** Live UI updates without polling.
- **Server lives in:** `internal/serve/events/handler.go` (SSE handler), backed by `internal/serve/events/hub.go` (in-process pub/sub with last-event-id replay).
- **Auth:** Bearer token in `Authorization` header (when using `@microsoft/fetch-event-source`) or as a query param (workaround for native EventSource which can't set headers).
- **Endpoints exposed:**
  - `GET /events/all` — every event in the hub.
  - `GET /events/session/{name}` — events filtered to one session.
- **Failure mode:** Client drop → handler's context cancels, hub Subscribe returns. Reconnect uses `Last-Event-ID` to replay missed events. Browser side: `ConnectionBanner` component flashes when SSE is down.
- **Cost / quota notes:** unbounded subscriber buffer would be a memory hazard — `events.Hub` uses a bounded channel per subscriber `[inferred — verify via `grep -n 'make(chan\\|cap' internal/serve/events/hub.go`]`.
- **Local-dev story:** Vite proxy in `ui/vite.config.ts` forwards `/events` with `ws: false` (SSE is HTTP/1.1 keep-alive, not websockets — no WS upgrade).

## Anthropic API (transitively, via claude CLI)

- **Purpose:** Claude Code's own model calls — ctm does NOT call the Anthropic API directly.
- **Client lives in:** Not in this repo. The `claude` binary handles its own credentials (`~/.claude/settings.json`).
- **Failure mode:** Surfaces as claude's own error output inside the tmux pane. ctm's preflight (`internal/health.Checker`) doesn't validate API connectivity — only the binary's presence on PATH.
- **Local-dev story:** install Claude Code per Anthropic's instructions; ctm wraps it.

## Local filesystem (treat as integration boundary)

- `~/.config/ctm/` — config, sessions, logs, SQLite. Owned by ctm, but watch for stale files when debugging cross-version weirdness; the `*.bak.*` files from migrations live alongside the live ones.
- `~/.bashrc`, `~/.zshrc` — `cmd/install.go` injects aliases via `internal/shell.AddAliases`. `cmd/uninstall` removes them by marker matching. Don't write outside the markers.
- `~/.cache/ms-playwright/` — Playwright's chromium download. One-time install via `pnpm exec playwright install chromium`.

## Ports

| Port | Bind | Purpose |
|---|---|---|
| 37778 | 127.0.0.1 | `ctm serve` HTTP daemon. Single-instance. |
| 5173 | (vite) | UI dev server (`make dev`). Strict — Vite refuses to fall back. |
| 4173 | 127.0.0.1 | Vite preview server during Playwright (`ui/playwright.config.ts`). |

No outbound public-network calls except the optional webhook. No CDN fonts (all `@fontsource/*` bundled per `rules/build.md`).
