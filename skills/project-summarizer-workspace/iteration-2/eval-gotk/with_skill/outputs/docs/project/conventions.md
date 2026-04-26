# Conventions

Rules to follow when modifying `gotk`. Each item: the rule, an example file, and the *why* if it's non-obvious.

## Code style

- **Stdlib only.** No third-party imports. The whole point of the project is air-gapped install via `go install .` (README: "Install"). Adding a dep silently breaks that contract. `go.mod` has zero `require` lines — keep it that way.
- **Flat `package main`.** Every `.go` file is at the repo root with `package main` (verified: `head -1 *.go | sort -u` yields exactly `package main`). No subpackages.
- **One filter per file** — `filter_<tool>.go` with a sibling `filter_<tool>_test.go`. Closely related tools may share (`filter_listing.go` covers `ls`/`tree`/`find`; `filter_misc.go` covers the four passthrough-cap-only tools plus npm).
- **Constants for caps live at the top of the file that uses them.** Examples: `lsLineCap = 100` in `filter_listing.go`; `grepTotalCap = 200`, `grepPerFileCap = 25` in `filter_grep.go`; `readDefaultMaxLines = 500` in `filter_read.go`. Don't centralize them — keeping per-file lets each filter tune independently.

## Error handling

- **Use `execExitCode(err)` from `common.go`** to translate `os/exec` errors to a CLI exit code. It maps `nil → 0`, `exec.ErrNotFound → 127`, `*exec.ExitError → ee.ExitCode()`, anything else → `1`. Tested in `common_test.go:TestExecExitCode`. Don't reinvent.
- **Stderr passes through; only stdout is reshaped.** Every filter assigns `cmd.Stderr = os.Stderr` before `cmd.Start()`. The single exception is `filter_tsc.go:34` which merges stderr into stdout intentionally — call out exceptions explicitly if you add another.
- **Filters degrade to passthrough on edge cases.** Each filter checks for flags it can't handle (watch mode, `--help`, `--version`, format-changing flags) and calls `passthrough(name, args)` instead of parsing. Examples: `filter_tsc.go` (`--watch`, `-w`, `--help`, `-h`); `filter_grep.go:grepHasFormatChangingFlag` (`-l`, `-c`, `-q`, `-o`, `--count`, etc.); `filter_lint.go` (`--help`, `--version`, or pre-existing `--format`); `filter_gotest.go:isJSONFlag` (`-json`, `-test.v=json`).
- **Errors-during-parse fall back to raw output.** `filter_lint.go` and `filter_gotest.go` both have a "if parse fails or exit ≥ 2, print raw" branch. This preserves the user's ability to debug.
- **`fmt.Fprintln(os.Stderr, "gotk:", err)` is the canonical error-print prefix.** Used throughout (`main.go`, every filter). Match this format for new errors.

## Naming

- **Source files:** `filter_<tool>.go`, `<tool>_test.go` siblings.
- **Handler functions:** `run<Tool>` (e.g. `runGit`, `runGo`, `runGrep`, `runRead`, `runLint`, `runLs`, etc.). The `handlers` map at `main.go:14-29` keys on the bare command name (`"git"`, `"go"`, `"grep"`, ...).
- **Cap constants:** `<tool>LineCap` (e.g. `lsLineCap`, `treeLineCap`, `dockerLineCap`).
- **Per-tool struct types:** `<tool>Summary` (e.g. `goTestSummary`, `tscSummary`, `lintSummary`) with a `render(io.Writer)` method.

## Tests

- **Colocated** — `foo.go` and `foo_test.go` live in the same dir (always repo root here).
- **Stdlib `testing` only.** No testify, no mocks, no fixtures dir.
- **Table-driven style** is the default. Canonical shape: `filter_git_test.go:TestHasFlag` (slice of struct cases, `t.Run(c.name, ...)`, `t.Fatalf` on mismatch).
- **Run all:** `go test ./...` or `make test`. **Run one:** `go test -run TestHasFlag .`.
- **Test data lives in test functions** — strings built with `strings.Join(..., "\n")` and fed to parser via `strings.NewReader`. See `filter_gotest_test.go:TestParseGoTestOutput_AllPass` for the canonical pattern.
- **Tests that touch the filesystem use `t.TempDir()` + `t.Setenv("GOTK_HISTORY", ...)`.** See `track_test.go:TestAppendEvent_WritesJSONL`. Never write into the developer's real `~/.gotk/`.

## Logging

- **No logger.** All output is via `fmt` to `os.Stdout` / `os.Stderr`. Errors prefixed with `gotk:` (see Error handling). The closest thing to "logging" is the JSONL history append in `track.go:appendEvent` — and that's analytics, not logs.

## Adding a new wrapped command

This is the highest-leverage recipe in the codebase.

1. Decide the policy. Is this a passthrough with a line cap (use the `execWithLineCap` / `execWithLineCapSkipping` helpers in `filter_listing.go` / `filter_misc.go`), or does it need real parsing (write a `parse<Tool>Output` + `<tool>Summary.render` like `filter_gotest.go` / `filter_tsc.go` / `filter_lint.go`)?
2. Create `filter_<tool>.go` at repo root, in `package main`. Define `run<Tool>(args []string) int`.
3. **Always:**
   - Open a `runCtx` via `startRun("<tool>")` (`track.go:18`).
   - Set `cmd.Stdin = os.Stdin`, `cmd.Stderr = os.Stderr` before starting (so the user can pipe in and so stderr passes through).
   - Use `countReader` / `countWriter` (`track.go:75-99`) to feed the analytics counters.
   - Call `ctx.finish(exit)` before returning, with the real exit code from `execExitCode(...)`.
   - Detect and short-circuit `--help`, `--version`, and any format-changing flags by calling `passthrough("<tool>", args)`.
4. Register the handler in `main.go:handlers` (the map literal at `main.go:14-29`). Key is the bare command name as the user types it after `gotk `.
5. Add a one-line entry in the `usageText` block (`main.go:31-67`).
6. Create `filter_<tool>_test.go` with at minimum: a parse-output test (table-driven) and a render test that asserts on `bytes.Buffer` contents.
7. Update `README.md` (the "When to use" table is the user-facing source of truth) and `GOTK.md` (instruction pack — this is what the LLM reads).
8. If the filter has rewrite rules an assistant should apply, also update `.github/copilot-instructions.md` "Command rewrite rules" section.

## Things to avoid (anti-patterns)

- **Don't add dependencies.** Even small ones. The whole project's value proposition is "stdlib-only, builds offline, no `go.sum`". This includes test-time deps.
- **Don't add hooks.** README "Non-goals": invocation is via model instructions, not shell aliases. A hook-based design (alias, shim, PATH-prepend) would break interactive commands.
- **Don't introduce a CLI framework** (cobra, kong, urfave-cli, ...). The dispatcher at `main.go:14-29` is intentional. See "Don't refactor" below.
- **Don't centralize the line-cap constants.** Each filter owns its caps because they tune to per-tool noise profiles. Centralizing them invites a config file, which invites a config parser, which invites a third-party YAML lib.
- **Don't write to `~/.gotk/` directly.** Always go through `historyPath()` (`track.go:39`) which honours `GOTK_HISTORY`. Tests will break otherwise.
- **Don't suppress stderr** unless you have a strong reason (the `filter_tsc.go:34` exception is the only sanctioned one).

## Don't refactor (intentional non-standard choices)

These look unusual but are deliberate. Verify with the maintainer before touching.

- **Hand-rolled dispatcher (`main.go:14-29` map literal) instead of cobra / urfave-cli.** The whole binary's argv parsing is `os.Args[1]` + map lookup. Rationale: zero deps + the surface is small enough that a framework would be heavier than the hand-rolled code (the dispatcher is ~10 lines). Don't "fix" by introducing a CLI library.
- **Flat `package main` at repo root, no `cmd/`, no `internal/`, no `pkg/`.** Verified: `ls -d cmd internal pkg` returns three "No such file or directory" errors. Rationale: single binary, ~1500 LOC total, the conventional Go layout would add directories without adding clarity. Don't reorganize into the standard layout for its own sake.
- **One filter per file with shared helpers in `common.go` / `track.go` / `filter_listing.go`.** Looks repetitive (each filter has near-identical pipe-and-count boilerplate). Rationale: each filter has subtle policy differences that resist abstraction. The boilerplate is the cheaper end of the trade. Don't extract a `Filter` interface unless you've genuinely reduced lines without losing the per-filter clarity.
- **No `go install` target in the Makefile.** README points users at `go install .` directly; the Makefile's `build` target only produces `bin/gotk`. Rationale: `go install` already does the right thing; wrapping it adds nothing. Don't add a redundant target.
- **`stripANSI` lives in `common.go` but only `filter_gotest.go` calls it.** It's used in `parseGoTestOutput` to keep `--- FAIL:` detection robust. Don't inline it without checking — other filters may add ANSI handling later. (`common.go:11`, used at `filter_gotest.go:53`.)
- **README install instructions sit *above* the usage docs (rather than after).** Intentional: the project's audience is engineers on restricted machines, and the install constraint *is* the differentiator. Keep the order.

If you spot another non-standard choice and can't find rationale, leave it alone and add an entry here noting "rationale unknown — confirm with maintainer".
