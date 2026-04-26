# Notes — project-summarizer eval, ctm, iteration 1

## 1. Deep-dives written and why

| File | Rationale |
|------|-----------|
| `PROJECT_SUMMARY.md` | Always written. |
| `docs/project/architecture.md` | Multi-component system (CLI + HTTP daemon + embedded React SPA), non-trivial layering (`cmd/` → `internal/` with `internal/serve/` as a self-contained subtree using HTTP-loopback IPC back to the CLI). Worth its own file. |
| `docs/project/data-model.md` | Multiple state stores (config.json, sessions.json, user.json, JSONL logs, SQLite ctm.db) with non-obvious interplay (schema_version migrations, atomic writes, FTS5). An agent modifying state-handling code must know which file is the source of truth. |
| `docs/project/ui.md` | Frontend is a real React 19 SPA with React Query, react-router 7, shadcn primitives, SSE provider, Playwright E2E — too much to fold into the top-level summary. |
| `docs/project/flows.md` | Four high-value journeys (attach, daemon startup, PostToolUse → SSE feed, UI mutation) cross multiple packages and would each be slow to reconstruct from cold reads. |
| `docs/project/conventions.md` | Adding a CLI subcommand, an HTTP route, a UI hook, or a lifecycle event each follow specific multi-file recipes. The "things to avoid" list pulls in real audit findings. |
| `docs/project/integrations.md` | Even though only two hard externals (tmux, claude) and one optional (webhook), the *non*-integrations are worth stating explicitly so an agent doesn't assume cloud SDKs / DBs / brokers exist. |
| `docs/project/build-and-run.md` | Build is multi-step (UI → rsync → Go) with a hard build-tag requirement (`sqlite_fts5`) and an embed-path constraint. One-line `go build` does not work; this file documents why and how. |

## 2. Deep-dives skipped and why

None. All seven canonical deep-dives were warranted for this project size and complexity. I considered folding `integrations.md` into `architecture.md` since the integration count is low, but kept it separate because (a) the *non*-integrations list (no DB server, no cloud, no telemetry) is itself useful context, and (b) the optional webhook needs configuration documentation that would clutter architecture.

## 3. Inferred vs verified

Items I marked `[inferred]` and flagged for later verification:

- **Argon2id** as the password algorithm in `internal/serve/auth/`. Inferred from `golang.org/x/crypto` in `go.mod` and the `algo`/`params` fields. Verify by reading `internal/serve/auth/password.go`.
- **`HookTimeout()` default = 5 seconds.** I cited the Resolved-helper pattern but the actual default constant (`DefaultHookTimeoutSec`) was visible in code only as a name; I didn't see the literal value. Verify in `internal/config/config.go`.
- **`Hub.NewHub(0)`** — I called out that whether `0` means unbounded or a default needs verification. `internal/serve/events/hub.go` not opened.
- **`cmd/log_tool_use.go` reads from stdin.** Inferred from Claude Code hook conventions. Verify in the file itself.
- **`integration_test.go` references `ctm safe`** — the help-text test asserts `safe` appears, but I did not find a `cmd/safe.go`. Either it's a yolo flag or the test is stale. Worth a one-line check.
- **`useTheme.tsx` honours `prefers-color-scheme`** — explicitly flagged as not verified; check before claiming a11y compliance.
- **No code-splitting / `React.lazy`** in the UI — inferred from `App.tsx` having all-static imports. Trivial to confirm.
- **Vite proxy `ws: false` for SSE** — verified directly in `ui/vite.config.ts`.
- **MSW usage** — `msw` is in devDependencies; whether vitest tests use it (vs. only Playwright route mocks) needs `ui/src/test-setup.ts` to be read.
- **`docs/superpowers/specs/2026-04-20-ctm-serve-ui-v0.1-design.md`** as the rationale for the daemon split — inferred from filename only.
- **The route table** in `internal/serve/server.go` — I did not read all 33 KB of `server.go`. The handler files in `internal/serve/api/` and the grep for `/api/...` strings gave me high confidence in the surface, but the exact routing-table pattern (mux per resource? per-method? subrouters?) wasn't observed.
- **`tsconfig.app.json` paths** — I claimed it has `@` alias; verify (only `tsconfig.json` was read in full; the references show it points at `tsconfig.app.json` and `tsconfig.node.json`).
- **`cmd/bootstrap.go`** as the first-time-setup command — inferred from the filename.

## 4. Skill friction

What worked well:

- The "sample, don't read everything" guidance was practical. With heavy use of `ctx_batch_execute` and grep-based listings, I avoided ever opening `internal/serve/server.go` (33 KB) in full and still produced grounded docs.
- The deep-dive table in `SKILL.md` is decisive — for each potential file I had a clear yes/no test.
- The `[inferred]` discipline is the single highest-leverage rule. It actively prevented me from making confident claims about the auth-cookie format or the hub's buffer policy.

What I found friction with:

1. **"Read on-demand" for `deep-dive-templates.md`** — I had to write 6 deep-dives, so loading the file once was efficient. The instruction "don't load all upfront" is right for small projects but mildly pessimistic for ones that warrant 5+ deep-dives. A note like "load once if writing >=4 deep-dives" would help.
2. **CLI-tool vs web-service archetype confusion** — ctm is genuinely both. The skill says "pick the dominant flavor for the top-level summary and use deep-dives for the rest." I picked CLI as primary but the daemon side is meaty enough that `architecture.md` and `flows.md` ended up being half web-service. The phrasing in `by-project-type.md` (`Strong candidate for ...`) handled this fine — but the skill could be more explicit that hybrid projects often warrant both flavors of deep-dive.
3. **The "Status: active — last commit X days ago" Identity field** is awkward when you can't tell from one commit whether the project is genuinely active or just had one update; for ctm it was fine (same-day commits in `internal/serve/` and README), but the heuristic isn't bulletproof. I cited the date and let the reader judge.
4. **Embed-path / build-tag idiosyncrasies** were the most valuable findings, and the `Gotchas` section of the template is the right place — but the skill might benefit from a small "Build-time gotchas worth surfacing" prompt. I caught these only because they were prominent in `Makefile` comments. In a project where they're hidden in a CI file, I might miss them.
5. **The route table verification** — for a Go web service with ~25 handlers wired in a single file, "every command listed: confirm it appears in the source" is hard without reading that file. I leaned on `grep '"/api/'` results from tests and let `[inferred]` cover gaps. This is consistent with the skill's intent (sample, don't exhaustively read) but worth flagging that handler-count claims in `architecture.md` are derived from file listings, not the route table itself.
6. **The "uncategorized gotchas" reporting in Step 6** is good in spirit but vague in practice. I rolled them into the `Gotchas` sections of summary + conventions — the skill could be explicit that the summary's Gotchas list and `conventions.md`'s "Things to avoid" / "Things to revisit" are the right homes.

## 5. Approximate time spent

Rough breakdown (my sense, not measured):

- Reading the skill: 2 minutes (single batch).
- Surveying the repo via 3 `ctx_batch_execute` calls: ~5 minutes (most of it was the model digesting indexed snippets).
- Drafting the seven docs: the bulk of the work — call it 12-15 minutes of tool calls + writing.
- Total: ~20 minutes of effective work.

Was the "sample don't read everything" guidance practical here? **Yes, decisively.** With ~50,000 lines of Go + ~5,000 lines of TS across `cmd/`, `internal/`, and `ui/`, exhaustively reading would have blown context budget and produced worse docs. The signal-hunting approach (one entry point per package, one test, key configs, README, CI files, plus targeted greps for things like `fireHook` call sites and `/api/...` strings) gave me enough surface area to write grounded summaries with explicit `[inferred]` markers where I didn't verify. The 33 KB `internal/serve/server.go` was the one file I deliberately didn't open and the docs are still high-fidelity.

The biggest leverage came from `ctx_batch_execute` letting me run 20 commands and 10 queries in one round trip — this is the right shape for the survey step in the skill.
