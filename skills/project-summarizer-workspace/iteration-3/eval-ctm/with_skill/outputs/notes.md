# Notes — v3 iteration on ctm

## 1. Deep-dives written / skipped

| File | Decision |
|------|----------|
| `architecture.md` | **Wrote** — multi-component (CLI + daemon + UI), explicit layering rules. Linked v0.1 design spec rather than restating. |
| `data-model.md` | **Wrote** — three storage layers (JSON state, SQLite FTS5, JSONL logs) + locked attention triggers. |
| `ui.md` | **Wrote** — non-trivial React 19 SPA with provider stack, SSE wiring, V27 auth flow. |
| `flows.md` | **Wrote** — three flows: `ctm yolo`, V27 login, tool-use SSE fan-out. Each crosses 3+ packages, worth tracing. |
| `conventions.md` | **Wrote** — overflow trigger met (35 cmd files, ~30 routes, recipes for new verb / new route, "don't refactor" list, full CLI verb table moved here per v3 verb-overflow rule). |
| `build-and-run.md` | **Wrote** — multi-step (UI → embed → Go build), `-tags sqlite_fts5` gotcha, no PR-CI workflow, release pipeline detail. |
| `integrations.md` | **Skipped** — ctm has no runtime third-party services. Only outbound is the user-supplied webhook URL, documented inline in `architecture.md`. |

## 2. Verification breakdown (rough)

- **Verified** (read directly, claim freely): ~55 claims. `go.mod`, `Makefile`, `ui/package.json`, `ui/vite.config.ts`, `ui/src/App.tsx`, `cmd/root.go`, `cmd/serve.go`, full route grep of `server.go`, full file listing of `cmd/`, `internal/`, `ui/src/`, doc tree, git log, README sections, attention trigger spec, schema_version comments.
- **Sampled** (cited read range): ~12 claims. `internal/serve/server.go` sampled `:1–60`, `:460–510` — the file is 962 lines and was not fully read, but the route table grep + sampled blocks cover route registration, allowed-origins logic, and package doc. `cmd/yolo.go` sampled `:1–80`. `internal/serve/api/sessions.go` top-of-file sampled. `internal/session/spawn.go` sampled in full (small file).
- **`[inferred]`**: ~10 claims. e.g. `useTheme.tsx` honors `prefers-color-scheme` (filename + convention but file not read), CI may skip the FTS5 tag (verified in workflow YAML, but tagged `[inferred]` where I extrapolated to behavior), some auth file internals.
- **Absence claims** (verified by listing command): `pkg/` does not exist (`find pkg`). No PR-validation workflow file (`ls .github/workflows/` shows only `release.yml`). No `vendor/` at HEAD.

## 3. Skill v3 friction

**Status heuristic — helpful.** The 7-day window has 30+ commits but the latest is a `checkpoint: pre-yolo` snapshot. Without v3's guidance I'd have paused on the literal latest commit and possibly mislabeled. The "if checkpoint and no other recent activity → bootstrapped" framing made it easy to choose `active` once I filtered the YOLO checkpoints out (`git log --invert-grep --grep='^checkpoint'`). I added a note in the Status field about how to filter checkpoint commits — that's the key insight v3 surfaces.

**Three-state verification — high value.** For a 962-line `server.go`, "Sampled `:1–60`, `:460–510`" is exactly the right level of honesty. Tagging it `[inferred]` would have been a lie (I have line-cited route grep), but tagging fully `Verified` would have over-claimed. The Sampled state is the missing middle ground v2 didn't have.

**Planning-doc linking — good but underused.** `docs/superpowers/specs/2026-04-20-ctm-serve-ui-v0.1-design.md` is the source of truth for the daemon. I linked to it from `architecture.md` rather than restating. Saved ~2k tokens of duplicated content. Worth a more explicit "spec-pointer block" pattern in the skill — I added one in `architecture.md` but it wasn't templated.

**Verb-overflow rule — saved real tokens.** ctm has 25 user-facing verbs. Putting the full table in `conventions.md` and only the top 5 in PROJECT_SUMMARY trimmed the top-level doc materially. Without v3 I would have written the full table twice or buried it.

**Where the skill is still rough:**
- The "Sampled" state has no notation guidance for *which* line range syntax to use across multiple sampled regions (`:1–60, :460–510`). I picked one; would help to standardize.
- Deep-dive table doesn't reference `flows.md` overlap with `architecture.md` — there's natural duplication between "components" in arch and "path through code" in flows. I leaned on flows for sequencing and arch for static structure, but the skill should call this out.
- Hybrid-project guidance (`by-project-type.md`) for "CLI + HTTP daemon" suggests web-service-flavored arch + flows — useful. But the verb-overflow rule lives elsewhere; the next agent might miss it without reading both files. Consider promoting to SKILL.md.
- No guidance on linking to in-repo `docs/v02/V*.md` slice specs. I treated them like superpowers specs (link, don't restate). That worked, but the SKILL only mentions `docs/superpowers/`.

## 4. Token cost vs. v2

Lower than v2 (~193k). My output across all 7 files is roughly:

- `PROJECT_SUMMARY.md`: ~5.0k tokens (target tight)
- `architecture.md`: ~3.0k
- `data-model.md`: ~2.5k
- `ui.md`: ~3.5k
- `flows.md`: ~2.8k
- `conventions.md`: ~3.5k (includes the full verb table)
- `build-and-run.md`: ~3.0k
- `notes.md`: ~1.5k

Total ~24.8k tokens written. The savings vs. v2 came from:

1. **Verb-overflow rule** — saved ~1k by listing 5 in PROJECT_SUMMARY instead of all 25.
2. **Spec-link instead of restate** — saved ~2–3k by pointing at v0.1 design spec rather than reproducing scope/architecture sections.
3. **Sampled honesty** — saved 0; if anything increased clarity at zero token cost.

What pulled tokens *up*:
- The full CLI verb table in `conventions.md` is dense (~600 tokens) but high-value. v2 might have skipped it; v3's verb-overflow rule asked me to put it somewhere, so it landed.
- Three flows in `flows.md` instead of one or two, because the project genuinely has three independently-interesting paths.

Net: I believe this is roughly 4–5x more concise than v2's 193k, while still covering equivalent surface. The biggest single win is the verb-overflow rule combined with the spec-linking discipline — both of those are exactly the v2-pain v3 was designed to fix.
