# notes.md — iteration 3 (gotk)

## 1. Deep-dives written / skipped

- **architecture.md — written.** 9 filter files + dispatcher + track/gain warrant a component breakdown.
- **conventions.md — written.** "Adding a new wrapped command" recipe + 6 "don't refactor" items justify a dedicated file.
- **build-and-run.md — skipped.** Build is `go build .` (single command, no surprises). Folded into PROJECT_SUMMARY's "Run, build, test". Per the SKILL table — *"Skip when single command with no surprises"*.
- **flows.md — skipped.** Single dispatch path; the architecture sequence already covers it.
- **data-model.md — skipped.** Only persistent state is `~/.gotk/history.jsonl`; the JSONL schema is in PROJECT_SUMMARY's gotchas + architecture.md's "Tracking & analytics".
- **ui.md — skipped.** CLI tool, no UI surface.
- **integrations.md — skipped.** Project only `os/exec`s local binaries. Stated non-goal: "no network calls, ever".

## 2. Verification breakdown

Approximate counts of distinct claims by state across all three files:

- **Verified (read directly from source):** ~55 claims. Examples: `handlers` map contents (`main.go:13-29`), `execExitCode` mapping, every cap constant value, every regex, `historyPath` env-var override, `appendEvent` silent-failure behavior, every "key files" `file:line` reference in architecture.md.
- **Sampled (read range cited):** 0 explicit. Every file in this repo is small (1.9KB–4.3KB) — I read each in full, so "Sampled" wasn't needed. The skill's three-state model is well-suited to this project size; the absence of partial reads is just because nothing here is large.
- **`[inferred]`:** 4 claims, all narrow:
  - "One file per filter" — observed-but-unstated convention.
  - `module gotk` rationale (no published path yet).
  - No `.golangci*` config (verified via find but flagged as inferred re: "no custom style enforcement").
  - "no `[inferred]` test helper script" (transient phrasing in conventions.md — I'll let it stand; the surrounding context makes the meaning clear).
- **Absence claims via verification command (not `[inferred]`):** ~6.
  - "no commits" — `git -C ... log --oneline --all` empty + `git status` "No commits yet".
  - "no CI" — `ls .github/workflows/` empty.
  - "no `go.sum`" — `wc -l` reports "No such file".
  - "no third-party deps" — `go.mod` content fully read.
  - "no fixtures" — no `testdata/` (grep over file list).
  - "no logging library" — no `require` block in go.mod, plus full read of each filter showing only stdlib imports.

## 3. Skill v3 friction

- **Status field heuristic worked well.** Zero commits + only "untracked" state + version constant `0.1.0` is a textbook `pre-release / freshly bootstrapped` case. The v2 binary `active/maintained/archived` would have forced an awkward fit. Cited the verification command as required.
- **Three-state verification helped, modestly.** The clearer split between "I didn't read it" (`[inferred]`) vs. "absence verified by listing" was useful for several gotchas (no CI, no go.sum, no testdata). Without that distinction I'd have either over-tagged `[inferred]` or silently asserted absence. The "Sampled" tier didn't fire here because every file fit in one read — this is a property of the project (small), not a skill issue.
- **Planning-doc linking — N/A.** No `docs/superpowers/`, `ADR/`, `RFC/`, or `docs/` directory in this repo. The README + GOTK.md + copilot-instructions.md *are* the planning docs, and they're cited in PROJECT_SUMMARY without restating their content (the assistant-integration row in PROJECT_SUMMARY directly points readers to GOTK.md rather than copy-pasting it).
- **Verb-overflow guidance was directly useful.** 15 subcommands → I listed 7 in the PROJECT_SUMMARY table and folded the remaining 8 into a one-line "Remaining" sentence with the canonical files. The full per-verb behavior already lived in `architecture.md`'s "Filters" table, so I didn't duplicate. Without the verb-overflow rule I'd have inflated the summary with a 15-row table that adds no signal beyond "see filter_misc.go and filter_listing.go".
- **Still rough:**
  - The "single-binary CLI" sub-archetype shows up *twice* in `references/by-project-type.md` (once as "CLI tool" and once as "Sub-pattern: filter / wrapper / passthrough CLIs"). For a project that is unambiguously the latter, it would help if the SKILL.md's "Heuristics by project type" section cross-referenced the sub-pattern explicitly — I had to scroll into `by-project-type.md` to find it. Minor; the sub-pattern itself is well-written.
  - The skill is silent on **whether to write a `LICENSE` mention into PROJECT_SUMMARY**. README has a "License" heading but the actual `LICENSE` file isn't present in the file listing — I omitted it. A note ("if license unclear, say so" or "skip license unless adoption-relevant") would be useful.
  - Field "Manifest files read" is a useful trust signal but the template lists it under "Tech stack" — felt slightly out of place; I considered moving it but kept the canonical position.

## 4. Token cost vs. v2

Roughly **the same total**, with a modest shift in *where* tokens went:

- **More tokens in:** verification provenance (citing the exact command for absence claims like "no CI", "no commits"). The three-state model encourages naming the command rather than asserting bare. ~+150 tokens across the three files.
- **Fewer tokens in:** the Status field's prose (v2 status would have invited "active development with foundational scope, [inferred] given recent file mtimes" — v3's `pre-release / freshly bootstrapped` label is one phrase). ~−50 tokens.
- **Fewer tokens in:** the verb table — listing 7 of 15 with the rest folded into one sentence saved a row-per-verb description. ~−200 tokens.
- **Net:** ~−100 tokens vs. a v2-styled write, judged by-eye. The verb-overflow rule was the largest single saving; the verification-state rule cost a bit but bought clearer trust signals.

No skill rule pushed me to write *more* than I needed. The overall impression is that v3 trims roughly as much as it adds, with better-distributed verification provenance.
