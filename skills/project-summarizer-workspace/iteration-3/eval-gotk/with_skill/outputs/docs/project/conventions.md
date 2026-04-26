# Conventions

Rules to follow when modifying this code. Each item: the rule, an example file showing it, and the *why* if it's non-obvious.

## Code style

- **Standard `gofmt`.** No custom formatter, no linter config. `[inferred]` — there is no `.golangci.yml` or similar; verified via `find /home/dev/projects/gotk -maxdepth 2 -name '.golangci*'` (no result).
- **Plain stdlib idioms.** `bufio.Scanner` with `Buffer(make([]byte, 1<<20), 1<<24)` is the standard incantation for streaming child output line-by-line — see `filter_grep.go:71`, `filter_gotest.go:54`, `filter_tsc.go:67`, `filter_listing.go:80`. Reuse it instead of inventing a new reader pattern.
- **Package-level constants for caps**, near the top of each filter file. Examples: `grepTotalCap = 200`, `grepPerFileCap = 25` (`filter_grep.go:13-15`); `lsLineCap = 100`, `treeLineCap = 300`, `findLineCap = 200` (`filter_listing.go:13-17`); `dockerLineCap = 300`, etc. (`filter_misc.go:13-19`). Keep new caps the same way.
- **Single-line method definitions are fine** for trivial wrappers. See `track.go:17-18` `addRaw` / `addFiltered`.

## Error handling

- **Use `execExitCode(err)` from `common.go:18`** to convert any `exec` error into a shell exit code. Don't roll a parallel implementation. Returns: `nil → 0`, `exec.ErrNotFound → 127`, `*exec.ExitError → ee.ExitCode()`, else `1`.
- **Forward the child's exit code.** Every `runX` ends with `return execExitCode(cmd.Wait())` (or its equivalent). Don't normalize `1` to `0` because parsing succeeded — see `filter_tsc.go:46-48` for the one principled exception (`tsc` returns 0 even when there are errors found via parse, so we promote to `1`).
- **Filter-specific errors go to stderr with the `gotk:` prefix.** Example: `fmt.Fprintln(os.Stderr, "gotk:", err)` (`filter_grep.go:30`).
- **History-write failures are silent.** `track.go:48-72` `appendEvent` deliberately swallows errors — observability must never crash a tool invocation. Don't add error reporting here.

## Naming

- **Files:** `filter_<tool>.go` for filters, `<concept>.go` for shared infra (`main`, `common`, `track`, `gain`).
- **Tests:** colocated, `_test.go` suffix, mirroring the source file name (e.g. `filter_grep.go` ↔ `filter_grep_test.go`).
- **Handlers:** `run<Tool>` (`runGo`, `runGit`, `runGrep`, `runTSC`, `runRead`, `runGain`, `runLs`, `runTree`, `runFind`, `runLint`, `runDocker`, `runKubectl`, `runCargo`, `runCurl`, `runNpm`). All return `int` (the exit code) and take `args []string`.
- **Constants:** `lowerCamelCase` package-private, e.g. `grepTotalCap`. No `ALL_CAPS`.
- **All code is `package main`.** No subpackages.

## Tests

- **Location:** colocated `*_test.go` next to source.
- **Style:** standard `testing` package, table-driven where it fits. Example: `filter_read_test.go:10-37` table of CLI-arg parsing cases. Simpler functions get a flat sequence of assertions (`common_test.go`).
- **Run all:** `make test` (= `go test ./...`).
- **Run one:** `go test -run TestStripANSI` (standard Go test runner). No `[inferred]` test helper script.
- **Fixtures:** there are none in-repo. Tests synthesize input strings inline (e.g. `common_test.go:18-22`, `filter_read_test.go:64`). Continue this style — no `testdata/` so far.

## Logging

- There is no logger. See `architecture.md` "Cross-cutting concerns" — gotk's design rejects ambient logging. If you need to debug, print to `os.Stderr` with the `gotk:` prefix temporarily and remove before commit.

## Adding a new wrapped command

This is the highest-value recipe in the codebase. To add support for a new tool `xyz`:

1. **Create `filter_xyz.go`** with:
   ```go
   package main

   import (
       "os/exec"
   )

   const xyzLineCap = 200 // or whatever the right cap is

   func runXyz(args []string) int {
       // Option A: pure passthrough with line cap
       return execWithLineCap("xyz", "xyz", args, xyzLineCap)
       // Option B: parse + reshape — copy the skeleton from filter_grep.go
   }
   ```
2. **Register in `main.go:13-29`** by adding a row to the `handlers` map: `"xyz": runXyz,`.
3. **Add a row to `usageText`** (`main.go:31`) describing the verb.
4. **Add `filter_xyz_test.go`** — at minimum, test the parse / reshape function with synthesized child-output strings. Don't shell out to the real `xyz` in tests (CI-unfriendly + non-deterministic).
5. **Update the user-facing instruction packs** so the model actually invokes `gotk xyz` instead of `xyz`:
   - `GOTK.md` — add a row under "When to use".
   - `.github/copilot-instructions.md` — add a row under "Command rewrite rules".
6. **Verify with `gotk gain`** — run `gotk xyz <args>` a few times, then `gotk gain` should show `xyz` in the per-command breakdown.

## Things to avoid (anti-patterns)

- **Don't add a CLI framework** (cobra, urfave/cli, kingpin, mow.cli). The `map[string]handler` in `main.go:13` is intentional. Adding a framework is a *third-party dep* — see "Don't refactor" below.
- **Don't add a logging library.** zap, zerolog, slog wrappers — none of them. `os.Stderr` is the logger.
- **Don't merge stderr into stdout** for new filters by default. The `tsc` filter does this (`filter_tsc.go:32`) only because tsc emits errors on stdout in some configs and stderr in others. New filters should keep stderr untouched.
- **Don't normalize unknown-tool failures.** If `exec.ErrNotFound` happens, the user gets exit 127. That's correct (POSIX convention). Don't add a friendly "tool not installed" wrapper.
- **Don't write history events from background goroutines.** `runCtx`'s atomic counters allow concurrent updates *within* an invocation, but `appendEvent` is called once at finish. Don't fan it out.

## Don't refactor (intentional non-standard choices)

These look unusual but are deliberate. **Verify with the maintainer (or open an issue) before "fixing" them** — they're the project's identity, not bugs.

- **Flat `package main` at repo root** — no `cmd/`, no `internal/`, no `pkg/` subdirs. Rationale: 23 files total, one binary, zero deps; subdirs would add ceremony without value. Verify via `ls /home/dev/projects/gotk` (everything is at the root).
- **Hand-rolled dispatcher (`map[string]handler`) instead of a CLI framework.** Rationale: zero-dependency policy. The dispatcher is ~5 lines (`main.go:73-80`) — a framework would be the largest dependency in the project. See `references/by-project-type.md` "Sub-pattern: filter / wrapper / passthrough CLIs" — this is the explicit recommended pattern for tools like this.
- **One file per wrapped tool** (`filter_<tool>.go`). Rationale: keeps each filter independently readable; no internal abstraction tax. Verify via `ls filter_*.go` (9 files, each 1.9–4.3KB).
- **Zero third-party Go modules.** `go.mod` is 21 bytes: `module gotk` + `go 1.22` and that's it. Stated rationale (`README.md` "Install" + `GOTK.md` "Install on restricted machines"): air-gapped / restricted environments where the user cannot fetch arbitrary binaries — only build from source. **A new `require` line is a breaking design change**, not a routine PR.
- **`module gotk` (no domain prefix).** Rationale: `[inferred]` — the tool is not yet published. Once it's hosted at `github.com/<owner>/gotk`, the module path will need to be rewritten. Until then, it stays bare. Don't "fix" prematurely; coordinate with publish-time.
- **Stderr merged into stdout in `filter_tsc.go:32`** but **not** in any other filter. Intentional — tsc's error stream is unreliable, but we don't want to apply that hack project-wide. Don't generalize.
- **Best-effort, silent failures in `track.go:appendEvent`.** Rationale: an unwritable home directory or full disk must never break a developer's `gotk go test`. Don't add error reporting.
