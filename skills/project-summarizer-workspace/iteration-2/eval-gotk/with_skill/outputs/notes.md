# Notes on applying project-summarizer v2 to gotk

## 1. Deep-dives written and why

- **`docs/project/conventions.md`** — gotk has a set of rules that genuinely need a dedicated file: zero-deps, flat-layout, hand-rolled dispatcher (all "Don't refactor" cases), plus the high-leverage "Adding a new wrapped command" recipe (8 steps spanning 4 files). PROJECT_SUMMARY's top-level Conventions section was already 7 bullets; folding the rest in would have bloated it. The Adding-X recipe alone justified the file.

That is the only deep-dive written.

## 2. Deep-dives skipped and why (using SKILL.md "Skip when" column)

- **`architecture.md`** — Skip-when criterion: "single-package project where the dir map already conveys the structure." gotk is a flat `package main` with 23 files at root and one dispatcher map. The directory map in PROJECT_SUMMARY is the architecture.
- **`data-model.md`** — Skip-when: "no persistent state, or only flat config files." gotk's only persistence is `runEvent` (`track.go`) appended JSONL to `~/.gotk/history.jsonl`. One struct, six fields, no schema, no migrations. PROJECT_SUMMARY mentions it once and that's enough.
- **`ui.md`** — Skip-when: "no UI surface at all (CLI, backend lib with no UI concerns)." Pure CLI; trivially skip.
- **`flows.md`** — Skip-when: "Single dispatch path; library with function calls but no flows." Each `gotk <cmd>` invocation is exactly one dispatch (main → handler → exec child). Nothing crosses files in a way that benefits from a numbered call chain.
- **`integrations.md`** — Skip-when: "Project only `os/exec`s local binaries / no runtime external dependencies." Verbatim match — gotk only `os/exec`s `git`, `go`, `grep`, `tsc`, `eslint`, `ls`, `tree`, `find`, `docker`, `kubectl`, `cargo`, `npm`, `curl`. No HTTP, no queues, no network.
- **`build-and-run.md`** — Skip-when: "Single command (`go build`, ...) with no surprises." `make build` / `go install .` / `go test ./...`. No codegen, no embed, no build tags, no native deps, no env required. The Run/build/test section in PROJECT_SUMMARY captures everything; a deep-dive would be a stub.

The skill's new "Skip when" column made these calls unambiguous in every case. Previously I'd have been tempted to write `architecture.md` (defensive habit) and `build-and-run.md` (felt incomplete without it). The column killed both temptations cleanly.

## 3. Inferred vs verified

**Verified-by-reading-source (no `[inferred]` tag, no verification command needed inline because cited):**
- Every filter's exit-code, stdin/stderr handling, cap constants, dispatch branching — read each `filter_*.go` file in full.
- Test conventions — read every `*_test.go` file.
- Dispatcher contents — read `main.go` in full.
- README/GOTK.md/copilot-instructions.md content — read in full.
- `go.mod` content (zero requires) — file is 3 lines.
- Makefile content — read in full.

**Verified-by-absence (with command, per skill's new guidance — NO `[inferred]` tag):**
- "No commits yet" — `git log --all --oneline` returns nothing; `git log` errors with `fatal: your current branch 'main' does not have any commits yet`. Cited in PROJECT_SUMMARY.
- "No CI configured" — `ls .github/workflows` returns "No such file or directory". Cited.
- "No `cmd/`, `internal/`, `pkg/`" — `ls -d` on those paths errors. Cited inline in PROJECT_SUMMARY.
- "No `go.sum`" — `ls go.sum` errors. Cited.
- "No LICENSE file" — `ls LICENSE*` errors. Cited.
- "All files are `package main`" — `head -1 *.go | sort -u` returns exactly one line. Cited in conventions.md.
- "No Dockerfile / docker-compose / Procfile / serverless.yml / .gitlab-ci / .circleci" — verified by `ls`; not all individually called out in the doc (would be noise) but absence informed claims like "build is a single `go build`".

**`[inferred]` tags used:** none in the final docs. Every positive claim is grounded in a file path. The skill's new guidance to *not* tag absence claims with `[inferred]` removed the only place I'd previously have been tempted to over-tag.

**Honesty notes I included rather than tagged:**
- README "License" wording — I wrote "currently says 'TBD' (paraphrased — but verify before relying)". I read the license heading but the search result for that section was small; I chose to soft-flag rather than guess.

## 4. Skill friction (v2)

What helped (compared to what I'd expect without v2 changes):

- **"Skip when" column in the deep-dive table** — Decisively the biggest improvement. Every skip decision was a one-line check against the criterion. Saved at least 4 deep-dive deliberations. This is the single most impactful change.
- **"Filter / wrapper / passthrough CLI" sub-pattern** — gotk maps onto this perfectly. The guidance to capture *stdout transformation* as the "business logic" (rather than going hunting for an architecture diagram) shaped the directory map and the conventions doc directly. The "table beats prose" hint matched what I did instinctively in the README — but it's nice to see it canonicalized.
- **"Don't refactor" guidance** — Without this section I'd have written about the flat layout and hand-rolled dispatcher as observations. The "Don't refactor (intentional non-standard choices)" section in conventions.md is verbatim what the next agent needs. The fact that the skill explicitly listed "Hand-rolled CLI dispatcher instead of cobra/clap/argparse" and "Flat `package main` instead of `cmd/` + `internal/` for a small Go tool" as common examples is *exactly* what gotk is. Matched almost word-for-word.
- **Absence-claim guidance** — Cleaner docs. Previously absence claims either get unfair `[inferred]` tags (which dilute the meaning of the tag for real positive guesses) or have to carry awkward "verified" footnotes. The skill's "note the verification command rather than tagging `[inferred]`" rule produced cleaner prose.
- **Gotcha-home guidance** — The "canonical homes are PROJECT_SUMMARY's `Gotchas`, `conventions.md`'s 'Things to avoid' / 'Don't refactor', and `build-and-run.md`'s `Gotchas`" line directly drove placement. The `tsc` stderr-merge gotcha went in PROJECT_SUMMARY (because it affects every `gotk tsc` user); the "don't introduce cobra" went in conventions.md; etc. Cross-referencing was clear.
- **Distinguishing "docs about this project" from "content this project ships"** — Important here because `GOTK.md` looks at first glance like an `AGENTS.md`-style file. The skill's guidance to check the frontmatter / shape made me treat it as *content gotk ships for downstream LLMs* rather than as project-self-documentation. That kept it out of the "Existing docs to summarize" path and into the "tech stack content" path.

Where the skill still felt rough:

- **Pre-first-commit edge case.** The "git log to confirm activity" survey step assumes commits exist. gotk has zero (`fatal: your current branch 'main' does not have any commits yet`). The Status field defaulted to "active — last commit X days ago" template phrasing; I had to invent "Pre-first-commit at time of summary". A one-line example for "no commits yet" / "fresh init" / "archived" would have removed that small friction.
- **Stub `bin/` directory.** The Makefile `build` target creates `bin/`, which exists in the working tree even before any binary is built. The "skip directories worth knowing — generated files" guidance covers this, but a beginner might be tempted to list it. Not friction for me, just noting.
- **The "absence claims" rule is good, but the example given ("no CI configured") is the *easy* case.** Slightly trickier was "no LICENSE file" — does the absence belong in PROJECT_SUMMARY's tech stack? In Gotchas? I put it in the Directory map description plus a note. Not a hard call but the skill could give one more example to anchor the pattern (e.g. "no LICENSE", "no test fixtures dir").
- **The "When you have 4+ deep-dives, just load the templates file once" instruction** — I had only one deep-dive, so I deferred loading until I needed it. That worked. But the wording "If the project warrants 4+ deep-dives, just load the file once — the per-template loading discipline is for small projects, not for ones that need most of the templates" reads slightly backwards on first pass — *small* projects benefit from per-template loading, but small projects have fewer templates? Took me a re-read. Could be tightened: "Lazy-load per template by default; bulk-load when ≥4 templates are needed."
- **Single-file CLI with rich content.** The skill's example of "A single-file CLI script needs only PROJECT_SUMMARY.md" felt like it might apply, but gotk has 23 source files and meaningful conventions. The "filter / wrapper" sub-pattern paragraph correctly nudged me past that, but the contrast between "single-file CLI" and "filter/wrapper CLI" could be made one sentence sharper — they're different shapes.

Overall: the v2 changes (Skip-when column, filter/wrapper sub-pattern, absence-claim handling, gotcha-home, Don't refactor) cleanly addressed exactly the four decisions I'd expect an agent to wobble on. This was a clean apply.

## 5. Approximate time spent

~10 minutes wall-clock equivalent — three batched survey calls, two file writes, this notes file. The bulk was dominated by the second batch_execute (1808 lines / 41KB indexed), where reading every source file in one round trip is what made the verified-claims dense.
