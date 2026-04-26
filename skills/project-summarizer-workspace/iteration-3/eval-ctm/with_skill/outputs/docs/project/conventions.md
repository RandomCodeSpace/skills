# Conventions

Rules for modifying ctm without breaking the maintainer's working model. Cite line refs where they exist; mark `[inferred]` claims so the next agent can verify.

## Code style

- **Go style:** stdlib-first. Pure Go: no jq, no pgrep, no grep, no uuidgen. README explicit: "Zero non-tmux runtime deps."
- **Slog only.** `log/slog` everywhere. Set up in `cmd/root.go:PersistentPreRunE` via `internal/logging.Setup(level)`. Don't pull in zap/zerolog.
- **Cobra one-verb-per-file.** Each verb gets its own `cmd/<verb>.go` plus `<verb>_test.go`. Wire via `func init() { rootCmd.AddCommand(<verb>Cmd) }` in the same file.
- **HTTP one-resource-per-file under `internal/serve/api/`.** Files export factory funcs that return `http.HandlerFunc`. Route registration belongs in `internal/serve/server.go` only.

## Error handling

- **Errors as values; no panics.** Wrap with `fmt.Errorf("context: %w", err)`. CLI commands return `error` from `RunE`; daemon handlers write JSON envelopes (status code + `error` field) `[inferred]` from sampled handler patterns — verify in `internal/serve/api/sessions.go`.
- **Self-healing on corrupted JSON:** `internal/jsonstrict` + atomic `.bak.<unix-nano>` rotation. Don't introduce best-effort JSON decoders.
- **Hard refusal on schema_version drift.** Newer-than-known `schema_version` causes startup failure. Don't add silent downgrade paths.

## Naming

- **Files:** `snake_case.go` for multi-word (`hooks_dispatch.go`, `log_tool_use.go`); single word otherwise.
- **Tests:** `*_test.go` colocated with source.
- **Packages:** short, lowercase, no underscores. Clear domain boundary: one job per package. The internal tree has 25+ packages — avoid creating a new one unless the boundary is real.

## Tests

- **Location:** colocated `*_test.go`. Plus root-level `integration_test.go` (cross-package smoke).
- **Build tag required:** `go test -tags sqlite_fts5 ./...`. Without it, `internal/serve/store/*_test.go` panics on FTS5.
- **Race + vuln:** the `regression` Make target runs `go test -race` and `govulncheck`. Don't merge without it.
- **Property tests:** `internal/session/state_property_test.go` exists — treat sessions.json as a place where property tests are welcome.
- **UI E2E mocks /api + /events.** Don't write E2Es that hit the live daemon.

## Logging

- **Levels:** debug | info | warn | error. Default info. CLI flag `--log-level` or legacy `--verbose`.
- **Format:** human (default) or NDJSON via `CTM_LOG_FORMAT=json`.
- **Stream:** stderr. stdout is reserved for command output (so pipes work).
- **Don't log secrets.** Auth tokens, password hashes — keep out.

## Adding a new …

### Adding a new CLI verb

1. Create `cmd/<verb>.go` with `var <verb>Cmd = &cobra.Command{...}` and `func init() { rootCmd.AddCommand(<verb>Cmd) }`.
2. Implement `RunE` returning `error`. Use `output.Stdout()` for user-facing prints.
3. Add `cmd/<verb>_test.go`.
4. If the verb needs the daemon, call `proc.EnsureServeRunning(cmd.Context())` first.
5. Update README "Commands" section if it's user-facing.

### Adding a new HTTP route

1. Create handler factory in `internal/serve/api/<resource>.go`. Signature: `func MyHandler(deps...) http.HandlerFunc`.
2. Define types in the same file (or `<resource>_types.go` if many).
3. Register in `internal/serve/server.go` next to similar routes:
   - Read-only: `mux.Handle("GET /api/<resource>", authHF(api.MyHandler(...)))`
   - Mutation: `mux.Handle("POST /api/<resource>", authHF(api.RequireOriginFunc(allowedOrigins, api.MyHandler(...))))`
   - Webhook ingestion (loopback-only, no auth): `mux.Handle("POST /api/hooks/{event}", api.Hooks(...))` style.
4. Add `<resource>_test.go` covering happy path + auth + origin matrix.
5. Add UI hook in `ui/src/hooks/use<Resource>.ts` (TanStack Query mutation/query).
6. Add Playwright spec under `ui/e2e/` if it's user-visible.

### Adding a new attention trigger

**Don't.** Triggers A–G are explicitly locked by the v0.1 spec (`docs/superpowers/specs/2026-04-20-ctm-serve-ui-v0.1-design.md` §1). If a new condition is needed, write a follow-up spec first and update the locked-trigger table. The next agent will assume A–G is the full set.

### Adding a new `schema_version` step

1. Bump `SchemaVersion` const in `internal/config/config.go` or `internal/session/state.go`.
2. Append a `Step{}` to `MigrationPlan().Steps` with the transform.
3. Add a test in the same package that loads an older fixture and asserts the migrated shape.
4. Verify the `.bak.<unix-nano>` rotation still fires (`internal/migrate` enforces it).

## Things to avoid

- **Don't run `go build` directly.** Use `make build`. Bare `go build` (a) misses the FTS5 tag, (b) misses the UI rsync, producing a binary that boots and panics on first FTS5 query.
- **Don't use `--no-edit` with `git rebase`** — not a valid flag, listed in `~/.claude/CLAUDE.md` as a hard rule.
- **Don't add a web framework.** Stdlib `net/http` with Go 1.22 method-prefixed routing is the choice. No chi/echo/gin/fiber.
- **Don't reintroduce paste-token auth.** Removed in `5d8dc61` and `92eebab`. V27 is cookie + argon2id.
- **Don't reintroduce Cmd+K palette.** Removed in `ea93aa9`.
- **Don't drop mobile input below 16px font-size.** iOS will zoom on focus (`d9e3b0a`).
- **Don't gzip /events.** SSE is HTTP/1.1 keep-alive streaming; buffering breaks it. See `ui/vite.config.ts:31–40` rationale.
- **Don't add new packages on a per-handler basis.** `internal/serve/api/` keeps a single package with one resource per file.
- **Don't write non-atomic state.** Use `internal/jsonstrict` and the atomic write/flock helpers in `internal/session/state.go`.

## Don't refactor (intentional non-standard choices)

- **Hand-rolled `mux.Handle("METHOD /path/{name}", …)` route table in `internal/serve/server.go`.** 962 lines, ~30 routes (sampled `:1–60` and `:460–510`; full route grep verified). This is intentional — Go 1.22 stdlib mux supports method+path, no router lib needed. Don't rip this out and bolt on chi/gorilla.
- **Sibling `internal/serve/dist/` for `//go:embed`.** Deliberate — `//go:embed` rejects parent-relative paths. The Makefile `rsync -a --delete ui/dist/ internal/serve/dist/` is the canonical way. Don't try `embed:"../ui/dist"`.
- **`internal/session/spawn.Yolo` lifted out of `cmd/yolo.go`.** Done in V26 so the daemon's `POST /api/sessions` shares a code path. Don't re-merge them.
- **CLI dispatcher uses Cobra but the binary is `ctm [name]` (positional optional arg).** `rootCmd.Args = cobra.MaximumNArgs(1)` and the default RunE is set in `attach.go`. Looks unusual but is the entire point — `ctm` alone attaches to the default session. Don't remove the bare-arg form.
- **Single `Hub` + ring buffer instead of pub/sub library.** Per v0.1 spec — in-process only, no external broker. Don't add nats/redis pubsub.

## Full CLI verb list

The 30+ verbs (`ls cmd/*.go` minus `_test.go` + `root.go`):

| Verb | File | Purpose |
|------|------|---------|
| (default attach) | `cmd/attach.go` (199 LOC) | `ctm` / `ctm <name>` — attach or create. |
| `attach` | `cmd/attach.go` | Explicit attach. |
| `auth` | `cmd/auth.go` (46 LOC) | `ctm auth reset` (V27). |
| `bootstrap` | `cmd/bootstrap.go` (192 LOC) | Initial setup. |
| `check` | `cmd/check.go` (119 LOC) | Preflight checks for a session, no attach. |
| `completion` | `cmd/completion.go` | Shell completion script. |
| `detach` | `cmd/detach.go` (29 LOC) | Detach from current session. |
| `doctor` | `cmd/doctor.go` (105 LOC) | Detailed env / state / fixes. |
| `forget` | `cmd/forget.go` (34 LOC) | Drop a stored session row. |
| `hooks-dispatch` | `cmd/hooks_dispatch.go` (77 LOC) | Internal hook handler. |
| `install` | `cmd/install.go` (154 LOC) | Install shell integration. |
| `kill` | `cmd/kill.go` (95 LOC) | Kill a tmux session. |
| `last` (`l`) | `cmd/last.go` (73 LOC) | Reattach most-recent live. |
| `list` (`ls`) | `cmd/list.go` (122 LOC) | List sessions. |
| `log-tool-use` | `cmd/log_tool_use.go` (124 LOC) | PostToolUse hook target. |
| `logs` | `cmd/logs.go` (439 LOC) | Query JSONL logs across rotation. |
| `new` | `cmd/new.go` (87 LOC) | Create session in workdir. |
| `overlay` | `cmd/overlay.go` (263 LOC) | Manage `claude-overlay.json`. |
| `pick` (`p`) | `cmd/pick.go` (132 LOC) | Interactive picker. |
| `rename` | `cmd/rename.go` (53 LOC) | Rename a session. |
| `serve` | `cmd/serve.go` (92 LOC) | Run HTTP daemon. |
| `statusline` | `cmd/statusline.go` (460 LOC) | Render claude statusline (largest verb). |
| `switch` (`sw`) | `cmd/switchcmd.go` (62 LOC) | tmux switch-client. |
| `version` | `cmd/version.go` (19 LOC) | Print version. |
| `yolo` / `yolo!` | `cmd/yolo.go` (296 LOC) | Permission-bypassed session. |

Total: 4477 LOC across 35 `*.go` files in `cmd/`.

## When to update this file

- New CLI verb → add a row to "Full CLI verb list".
- New HTTP route family → mention in "Adding a new HTTP route".
- New schema bump → no edit here; the fact lives in the per-package `state.go` / `config.go`.
- Removal of an existing convention → add it to "Things to avoid" so future agents don't reintroduce.
