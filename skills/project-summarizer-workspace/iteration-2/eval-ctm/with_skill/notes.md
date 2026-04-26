# Notes — project-summarizer v2 applied to `~/projects/ctm`

## 1. Deep-dives written and why

| File | Why written |
|---|---|
| `docs/project/architecture.md` | Multi-component hybrid: CLI + HTTP daemon + ingest tailers + SQLite + SSE hub + React SPA. Single-binary deployment hides real layering. The dependency direction (cmd → internal; serve.api → adapters → ingest) is non-obvious and worth documenting. Skill table: "Multi-component system, non-trivial layering". |
| `docs/project/data-model.md` | Three persistence layers with distinct contracts: versioned+flock JSON state, append-only JSONL logs, SQLite (cost rows + FTS5 virtual table). Migration system is custom (`internal/migrate`). The wipe-on-boot FTS index is a non-obvious invariant. Skill table: "Database, schema files, or domain entities worth tracing". |
| `docs/project/ui.md` | The project explicitly has a `ui/` folder (user said so), it's a real app surface (React 19 + TanStack + react-router 7), and the routing intent ("two-pane mode keeps Dashboard mounted") is load-bearing. Skill table: "Frontend app". |
| `docs/project/flows.md` | Four flows cross many files (`ctm <name>` walks through 11 files; tool-call ingest walks CLI hook → JSONL → tailer → SQLite → SSE → UI). Numbered call-chain format is high leverage for the next agent. Skill table: "1+ key journeys that cross multiple files". |
| `docs/project/conventions.md` | Convention list overflowed PROJECT_SUMMARY's top-level cap (>10 rules including layering, error handling, logging, "adding a new X" recipes for routes/commands/configs/hooks, and a substantial Don't-refactor section). Skill table: "Conventions overflow PROJECT_SUMMARY's top-level list, OR there's an Adding a new X recipe". Both apply. |
| `docs/project/integrations.md` | Calls `tmux`, `claude`, `git` as local binaries; outbound webhook to user-configured URL; SSE to browser. Each has its own auth/failure/local-dev story. Skill table: "Calls external APIs, queues, message brokers, third-party services" — local-binary integrations qualify here per the skill's spirit (the patterns are identical). |
| `docs/project/build-and-run.md` | Build is genuinely non-trivial: mandatory build tags, frontend→backend embed pipeline, rsync into source tree, multi-step regression pack, cross-compile release matrix, vendored air-gapped path. A one-line command can't capture this. Skill table: "Multi-step, build tags, codegen, embed paths, multiple targets". |

## 2. Deep-dives skipped and why

None. The hybrid-project guidance in the v2 skill explicitly lists "CLI + HTTP daemon" as warranting `architecture.md`, `flows.md`, and `build-and-run.md`. Combined with the user's mention of a UI folder (warrants `ui.md`) and the inherent data + integrations + conventions complexity, all seven listed deep-dives applied. I considered skipping `integrations.md` since "external" is local-binary heavy, but the failure modes / auth / local-dev story per binary made the file dense enough to warrant its own home rather than fattening the conventions doc.

## 3. Inferred vs verified

**Verified by reading source / commands** (no `[inferred]` tag): everything in PROJECT_SUMMARY's command tables, the `Makefile` targets, the `go.mod` deps, the `Config` struct fields, the `Session` struct fields, the route registration patterns in `server.go:registerRoutes`, the auth/origin middleware order, the BuildCommand fallback behavior, the `shouldResumeExisting` regression note, the embed path comment, the Vite proxy config, the Playwright mock-route strategy, the JSONL logger sanitization, the migration runner semantics, the `release.yml` matrix.

**Marked `[inferred]` (positive guesses I did not directly read the file for):** `internal/prompt/path.go` semantics; the existence of a `MigrationPlan()` adjacent to `internal/session/state.go`; the in-memory non-persistence of `auth.NewStore()`; the existence of a `ThemeProvider` honoring `prefers-color-scheme`; whether `internal/serve/events/handler.go` is the SSE handler file (vs hub.go); the exact verbs ctm passes to `git`; the size/age log rotation invocation site for `serve` boot; `tailwind.config.js` truly absent; that `internal/serve/dist/index.html` 404s when missing rather than embed-failing; whether the release `go test ./...` step's missing `-tags sqlite_fts5` is intentional.

**Absence claims (verified by `ls`/`grep` rather than `[inferred]`):**
- "No `PROJECT_SUMMARY.md` / `AGENTS.md` / `CLAUDE.md` / `docs/project/` exists" — verified via `ls`, all four returned `No such file or directory`.
- "No CI workflow other than release.yml" — verified via `ls .github/workflows/` returning only `release.yml`.
- "No Storybook" — verified by absence in `ui/package.json` deps.
- "No `react-hook-form` / `zod` / `formik`" — verified by absence in `ui/package.json` deps.
- "No `tailwind.config.js`" — TailwindCSS v4 is CSS-first; verification command would be `find ui -name 'tailwind.config*'` (recommended in the doc but not run during this survey).
- "No CGO required" — actually I marked this `[inferred]` and called it out as "VERIFY"; `release.yml` sets `CGO_ENABLED=0` but `mattn/go-sqlite3` traditionally requires CGO. I flagged this as a real follow-up rather than papering over it.

For the >700-line `internal/serve/server.go:registerRoutes`, I sampled enough of the route table (auth routes, sessions CRUD, mutation flow with origin gate, SSE handlers, debug endpoint, asset fallback) to characterize the patterns and marked the unread portions implicitly via "the rest of the surface is wired the same way" — per the v2 skill's exception for very large hand-rolled route tables. Routes I did NOT walk individually: search, subagents, teams, tool_call_detail, cost — all listed by file under `internal/serve/api/files`.

## 4. Skill friction (v2)

**What worked well:**

- **Hybrid-project guidance was directly useful.** The "Common hybrid combinations" table called out "CLI + HTTP daemon" specifically, which let me confidently set the top-level type to "CLI tool with embedded HTTP daemon and React SPA" and split secondary concerns into deep-dives without agonizing over fit.
- **"Don't refactor" guidance shaped real content.** I added that section to `conventions.md` covering the hand-rolled cobra dispatcher, single registerRoutes function, in-memory auth store, the `internal/serve/dist/` rsync arrangement, hardcoded port in proc/spawn.go, the `shouldResumeExisting` regression note, and the no-tailwind.config decision — every one of those is the kind of thing an agent would "fix" without context.
- **Big-route-table verification exception.** `registerRoutes` is exactly the kind of file the new exception was written for: ~150 mux.Handle lines. Sampling + marking the unread surface implicitly was clearly correct here.
- **"Load deep-dive templates once for 4+" guidance** — I loaded `references/deep-dive-templates.md` upfront because I knew this would be a 7-template project. The per-template lazy-loading would have been pure overhead.
- **Gotcha-home guidance (PROJECT_SUMMARY / conventions / build-and-run).** The `-tags sqlite_fts5` rule legitimately appears in all three locations (PROJECT_SUMMARY Gotchas + Conventions #1 + build-and-run.md Gotchas). The cross-references felt earned, not redundant.

**Where the skill still felt rough:**

- The skill does not directly address the case where the **target repo has substantial planning/spec markdown of its own** (`docs/superpowers/`, `docs/v02/`). I noted these in the directory map but didn't extract anything from them. A one-liner like "respect existing planning docs as content, not metadata; cite but don't duplicate" would help — currently I had to apply the existing "content this project ships" rule by analogy.
- For very-active monorepo-ish single-binary projects with a `cmd/` containing 30+ verbs, **enumerating every CLI verb feels noisy** in PROJECT_SUMMARY — but the skill's "list subcommands" advice for CLI tools doesn't address this. I ended up grouping by verb family in the Conventions doc and pointing at `cmd/` as a directory rather than enumerating in the entry-points table. The skill could acknowledge this trade-off explicitly.
- "Status: active — last commit 3 days ago" guidance is rough when the most recent commit on `main` is itself a "checkpoint: pre-yolo" empty commit (which it was here). I noted this but left the heuristic intact. A more nuanced "ignore checkpoint commits when computing recency" would be a nice-to-have.
- The skill suggests `[inferred]` for positive claims you didn't verify, but is silent on **claims you've half-verified by sampling** (e.g., "the route surface is wired this way; I sampled 15 of ~40 routes"). I improvised by mentioning the sampling explicitly in flows + this notes file. A pattern like `[sampled]` or `[partial]` could fit between `[inferred]` and verified.

## 5. Approximate time spent

~25 minutes of wall time, dominated by three large `ctx_batch_execute` rounds (~3-5 minutes each including indexing/search) plus the document-writing phase (~10 minutes). No source files entered my context window directly — everything routed through context-mode batch_execute and ctx_search.
