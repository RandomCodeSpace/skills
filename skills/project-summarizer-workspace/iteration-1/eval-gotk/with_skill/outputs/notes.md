# Notes — project-summarizer applied to gotk

## Deep-dives written and why

- **`docs/project/architecture.md`** — Even though gotk is "small", the dispatch + per-filter structure has enough variation across 8 filter files that a per-component table earns its keep. The component table also documents which strategy (pure passthrough / line-cap / stream-reshape / buffer-reshape) each filter uses, which is exactly what the next agent needs before adding a new command.
- **`docs/project/conventions.md`** — The "add a new filtered command" recipe is the highest-leverage document for an agent modifying this repo. Folding it into PROJECT_SUMMARY.md would have crowded out the gotchas, and the recipe needs ~10 numbered steps with file refs to be useful. Conventions also pin the no-third-party-deps and no-subpackages invariants, which are load-bearing for the project's value proposition.
- **`docs/project/build-and-run.md`** — Three install paths (`go install .`, `make build`, `go install ...@latest`), each with different prereqs and air-gap implications. Plus the no-CI / no-commits / pre-built-bin/ gotchas warrant a dedicated file rather than scattered notes in PROJECT_SUMMARY.

## Deep-dives skipped and why

- **`docs/project/data-model.md`** — No database, no ORM, no domain entities. The only persisted state is a JSONL history file with a fixed 6-field shape (`runEvent` in `track.go`); that's already captured in PROJECT_SUMMARY.md and architecture.md. A whole file would be skeletal noise.
- **`docs/project/ui.md`** — No UI. CLI-only.
- **`docs/project/flows.md`** — The "user flow" here is `dispatch → filter → exec child → reshape stdout → track event → exit`. That's a single path, and architecture.md's ASCII diagram already captures it. Per-command flows would just rephrase the per-filter rows in architecture.md.
- **`docs/project/integrations.md`** — No external APIs, no queues, no third-party services. The tool only `os/exec`s local binaries. Documenting "we exec git" would not be useful.

## Inferred vs verified

Marked `[inferred]` in the docs (and would want to verify):

- The exact line numbers I cited for `main.go:71-89` (the `main()` function body). The code is small enough that a quick re-read would confirm, but I didn't pin every single line during sampling.
- `filter_lint.go` shells out to bare `eslint` without resolving `node_modules/.bin/eslint` — verified by reading `exec.Command("eslint", full...)`, so this is on the boundary of inferred/verified. Marked inferred to be safe.
- `go test -run TestName` for running a single test — standard Go convention, not specific to this project; called out as inferred.
- "No release automation" — verified by checking `.github/` has only `copilot-instructions.md` and no `workflows/` dir, but the absence of GoReleaser config files etc. is inferred negative-evidence.

Verified directly by execution:
- `go build` succeeds on Go 1.26.2.
- `go test ./...` passes (`ok gotk 0.008s`).
- `go.mod` is 21 bytes with no `require` lines.
- `.gitignore` content.
- All filter file contents and the `handlers` map in `main.go`.
- Git status: no commits yet, everything untracked on `main`.

## Skill friction

What was unclear / hard to apply:

1. **Single-package flat-Go-CLI is a "CLI tool" archetype but the references/by-project-type.md CLI section is thin** — it focuses on argv-parsing libraries (`cobra`, `clap`) and "where business logic separates from CLI plumbing". gotk has neither cobra nor a real domain logic split (the "logic" is text reshaping that lives entirely in the filter file). I had to improvise. The CLI archetype could mention "filter / wrapper / passthrough CLIs" as a sub-pattern.
2. **The "deep-dive when in doubt write fewer" guidance is correct, but the table doesn't say what to do for tiny CLIs** — I leaned on the "If you can't fill a deep-dive with concrete, file-grounded content, fold the one or two useful sentences into PROJECT_SUMMARY.md instead" rule, which is the right call. But for a 23-file flat repo, I had to actively justify *not* writing data-model.md / ui.md / integrations.md, none of which apply. Maybe the SKILL.md table could include a "definitely skip if..." column.
3. **Conventions vs. PROJECT_SUMMARY's "Conventions an agent must respect"** — I duplicated the top 7 in PROJECT_SUMMARY and then expanded in conventions.md. The skill says "full set lives in conventions.md", which I did — but the line between "top 3-7" and "the full set" is judgment. For this project the recipe ("Adding a new filtered command") was clearly worth its own file, so the call was easy.
4. **"Mark uncertainty `[inferred]`" is great guidance, but I had a few "verified-by-absence" claims** (no CI, no release automation, no third-party deps) where there's no positive file to cite. I treated those as verified-by-`ls -la /home/dev/projects/gotk/.github` returning only `copilot-instructions.md`. Fine, but worth noting that "absence" claims need a different verification mode than "presence" claims.
5. **The system reminded me to use `ctx_execute_file` rather than `Read` for analysis** — that worked well for surveying contents efficiently. I did use `Read` only to read the skill's own files (since I was going to follow them, not edit them — though the system would have preferred ctx_execute_file there too). For target-project source, I exclusively used `ctx_batch_execute` + `ctx_search`, which kept raw output out of context entirely.

## Approximate time spent

Roughly 20-25 minutes of effective work (excluding skill-reading time): ~10 minutes on surveying via two `ctx_batch_execute` calls + targeted searches, ~5 minutes deciding deep-dive scope, ~10 minutes writing the four output files. The "sample don't read everything" guidance was very practical: I never opened most files in raw form — the indexed search returned representative slices that were enough to characterize each filter and pin the shared abstractions (`countReader`/`countWriter`, `execExitCode`, the handler signature). For a project this small, reading every file would also have worked, but the discipline kept the workflow scalable to bigger repos.
