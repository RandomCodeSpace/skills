# External Integrations

ctm is deliberately self-contained. There are exactly two hard external dependencies (tmux and the claude CLI) and one optional outbound integration (a user-configurable webhook). No databases, message brokers, or cloud APIs are involved at runtime.

## tmux (subprocess)

- **Purpose:** All session lifecycle. ctm names tmux sessions, attaches the user, sends keys, and ties the lifecycle of a tmux session to the underlying claude process.
- **Client lives in:** `internal/tmux/client.go` (subprocess wrapper) + `internal/tmux/config.go` (writes the ctm-managed `tmux.conf` returned by `config.TmuxConfPath()`).
- **Auth:** None — local subprocess.
- **Endpoints / topics used:** Standard tmux CLI verbs (`new-session`, `attach-session`, `send-keys`, `kill-session`, `list-sessions`, `set-option`, etc.). Concrete invocations live in `internal/tmux/client.go` `[inferred from caller patterns; not directly read]`.
- **Failure mode:** If `tmux` is missing or the version is < 3.0, `internal/health/tmux_check.go` fails preflight before any session command runs. Hard requirement (`README.md` Requirements).
- **Cost / quota notes:** N/A.
- **Local-dev story:** Real tmux. Tests that need it skip in CI (`integration_test.go:65-68` skips `TestIntegration_CreateAndKill` when `$CI` is set or when tmux is absent).

## Claude Code CLI (subprocess)

- **Purpose:** ctm's reason to exist — running `claude` inside tmux. Includes resume semantics: `claude --resume UUID || claude --session-id UUID` (`README.md` Features).
- **Client lives in:** `internal/claude/command.go` (build argv, source `env.sh`), `internal/claude/process.go` (Linux `/proc` walk to find the claude PID under a tmux session), `internal/claude/tui.go`, `internal/claude/remote_control.go`, `internal/claude/jsonpatch.go`.
- **Auth:** Whatever `claude` itself uses (Anthropic API key); ctm does not handle this. The user's `~/.claude/` config and any optional ctm overlay (`claude-overlay.json` passed via `--settings`) carry the credentials path.
- **Endpoints / topics used:** Spawned as a subprocess inside the tmux pane. ctm interacts with it via:
  - **stdin/keystrokes:** through `tmux send-keys` (UI input flow).
  - **PostToolUse hook:** the overlay registers `ctm log-tool-use` (or similar `[inferred command name]`) so claude calls back into ctm for every tool invocation. Payload is JSONL on stdin (`cmd/log_tool_use.go`).
  - **Statusline hook:** the overlay registers ctm's statusline (`cmd/statusline.go`) which writes a per-session JSON dump into `StatuslineDumpDir` (default `/tmp/ctm-statusline`) — read by `internal/serve/ingest/quota.go`.
- **Failure mode:** Missing claude → preflight fails (`internal/health/claude_check.go`). Crashed claude → tmux session dies because of "tight lifecycle coupling" (`README.md` Features). On reattach, `claude --resume UUID || claude --session-id UUID` recovers from missing history.
- **Cost / quota notes:** Anthropic-side; ctm only surfaces the usage it learns from the statusline JSON dumps and the JSONL tool-use logs.
- **Local-dev story:** Real claude on `$PATH`. No mock/stub in the Go test path. UI E2E mocks the symptoms (`/api` and `/events` responses) rather than mocking claude itself.

## Outbound webhook (optional)

- **Purpose:** Notify an external system when ctm fires a lifecycle event (`session_new`, `session_attached`, `session_killed`, `on_yolo`). Designed for personal automation — push notifications, Slack/Discord pipes, etc.
- **Client lives in:** `internal/serve/webhook/` (Dispatcher).
- **Configured via:** `~/.config/ctm/config.json` →
  ```json
  {
    "serve": {
      "webhook_url":  "https://...",
      "webhook_auth": "Bearer abc123"
    }
  }
  ```
- **Auth:** The `webhook_auth` string is sent verbatim in the `Authorization` header on each POST (`internal/serve/server.go` Options doc). User-supplied; ctm doesn't generate or rotate it.
- **Endpoints / topics used:** Single configured URL. ctm POSTs JSON for each hub event (one URL serves all events; the consumer demuxes by payload).
- **Failure mode:** Disabled when `webhook_url` is empty. When enabled, dispatcher failures are logged via slog and don't block the hub. Retry/backoff semantics: not yet read; check `internal/serve/webhook/` before relying on at-most-once / at-least-once expectations. `[inferred]`
- **Cost / quota notes:** Whatever the user's endpoint imposes.
- **Local-dev story:** Leave `webhook_url` empty — dispatcher is a no-op. For live testing, point at a local httpbin or `nc -l` listener.

## Things ctm does *not* integrate with

Worth stating explicitly so an agent doesn't assume otherwise:

- **No database server.** SQLite is embedded (`mattn/go-sqlite3`); the file is `~/.config/ctm/ctm.db`.
- **No message queue / broker.** In-process `events.Hub` is the only pub/sub.
- **No cloud SDKs.** No AWS / GCP / Azure SDK in `go.mod`.
- **No telemetry / analytics service.** No outbound calls beyond the optional user-configured webhook.
- **No font / icon CDN.** Bundled via `@fontsource/*` and `lucide-react`.
- **No update / version-check endpoint.** `ctm version` reads the binary's embedded build info; nothing pings home.
- **No mTLS or external auth provider.** Single-user local auth via `internal/serve/auth/`.

## Loopback "integration" with self

The CLI side calls back into the daemon via `internal/serve/proc/`:

- `proc.EnsureServeRunning(ctx)` — best-effort spawn (`cmd/attach.go:55`).
- `proc.PostEvent(event, form)` — POSTs to `http://127.0.0.1:<port>/api/hooks/<event>` with a `url.Values` form (`cmd/hooks_dispatch.go:80-86`, `internal/serve/proc/spawn.go:69`).

This is technically an HTTP integration but with itself — design choice documented in `docs/superpowers/specs/2026-04-20-ctm-serve-ui-v0.1-design.md` `[inferred from filename, not read]`. If the daemon isn't running, both calls are silent no-ops; the CLI flow continues.
