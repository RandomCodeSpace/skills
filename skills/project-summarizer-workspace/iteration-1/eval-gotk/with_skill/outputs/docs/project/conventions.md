# Conventions

Rules to follow when modifying gotk. Each item: the rule, an example file showing it, and the *why* if it's non-obvious.

## Code style

- **`package main`, flat layout.** Every `.go` file lives at repo root in `package main`. See `main.go`, `filter_grep.go`. Why: keeps the install path `go install .` and avoids any module/package ceremony for what is intentionally a small tool.
- **Stdlib only.** `go.mod` is 21 bytes (`module gotk`, `go 1.22`) and must stay free of `require` lines. See `go.mod`. Why: the project's value proposition is "buildable from a clone with no proxy access" (`README.md` § Install).
- **Minimum Go version is 1.22** (`go.mod:3`). The codebase has been observed building on 1.26.2 in this sandbox, but don't reach for 1.23+ language features.

## Error handling

- **Map errors to POSIX exit codes via `common.go:execExitCode`.** `nil`→0, `exec.ErrNotFound`→127, `*exec.ExitError`→its code, else 1. Don't invent new error → exit-code mappings in filters.
- **Stderr and exit codes pass through unchanged.** Wire `cmd.Stderr = os.Stderr` and return whatever `execExitCode(cmd.Wait())` produces. See `filter_git.go:runGitCmd` for the canonical shape.
- **Filters never panic.** All errors are printed as `gotk: <err>` to stderr via `fmt.Fprintln(os.Stderr, "gotk:", err)` (see `filter_git.go`, `filter_misc.go`) and the function returns a non-zero int.
- **Analytics writes are best-effort.** `track.go:appendEvent` deliberately swallows every error from `MkdirAll`/`OpenFile`/`Marshal`/`Write`. Don't propagate errors out of the history path; analytics must never break a real command.

## Naming

- **Files:** lowercase with underscores. Filter files are `filter_<command>.go`; tests are `<name>_test.go`. Examples: `filter_grep.go`, `filter_grep_test.go`, `track.go`, `track_test.go`.
- **Handler symbols:** `runX` where X is the command (`runGit`, `runGo`, `runTSC`, `runRead`, `runGain`, `runLs`, `runTree`, `runFind`, `runLint`, `runDocker`, `runKubectl`, `runCargo`, `runCurl`, `runNpm`, `runGrep`). Registered in `main.go:13` `handlers` map.
- **Filter signature:** `func runX(args []string) int`. The `int` is the exit code. Match the `handler` type alias in `main.go:11`.

## Tests

- **Colocated.** Tests live next to the file under test, in the same package. There is no `tests/` or `internal/` directory.
- **Test pure parsing functions directly.** Don't spawn the real tool in unit tests. Pattern: extract a parser like `parseGoTestOutput(r io.Reader) goTestSummary` (`filter_gotest.go`) and feed it `strings.NewReader(input)` from the test (see `filter_gotest_test.go:TestParseGoTestOutput_Failure`). Same for `parseESLintJSON` (`filter_lint.go`), `groupGrepLines` (`filter_grep.go`), `renderGain` (`gain.go`).
- **Run all tests:** `go test ./...` (Makefile `test` target). Verified passing.
- **Run a single test:** `go test -run TestParseGoTestOutput_Failure` (`[inferred]` — standard Go test runner; not project-specific).

## Logging

- **None.** No logger library, no structured logging. Errors go to `os.Stderr` via `fmt.Fprintln`. Don't introduce a logger.

## Adding a new filtered command

This is the recurring high-value recipe in this codebase. The pattern is consistent across every filter.

1. **Create `filter_<cmd>.go`** at the repo root. Define `func runX(args []string) int`.
2. **Decide the strategy** (and copy the closest existing filter):
   - Pure passthrough with cap → use `execWithLineCap("<binary>", "<label>", args, capN)` from `filter_listing.go` / `filter_misc.go`.
   - Cap + line-skip noise → use `execWithLineCapSkipping(...)` from `filter_misc.go` (see `runNpm`).
   - Stream-and-reshape → mirror `runGitCmd` (`filter_git.go`): `startRun(label)`, `cmd.StdoutPipe`, wrap reader in `&countReader{r: pipe, ctx: ctx}`, wrap writer in `&countWriter{w: bw, ctx: ctx}`, do your transform, `bw.Flush()`, `ctx.finish(execExitCode(cmd.Wait()))`.
   - Buffer-then-reshape (when you must read everything before deciding) → mirror `gitDiff` in `filter_git.go` or `runLint` in `filter_lint.go`: `cmd.Output()`, decide based on size/content, then write.
3. **Always preserve passthrough escape hatches.** Detect `--help`, `--version`, watch modes, JSON/format flags, and short-circuit to `passthrough()` or a plain line-cap. Examples: `filter_gotest.go:isJSONFlag`, `filter_tsc.go` watch/help check, `filter_lint.go:runLint` `--format` check.
4. **Register in `main.go:13`** by adding `"<cmd>": runX,` to the `handlers` map.
5. **Update `usageText`** in `main.go:30` so `gotk --help` documents the command.
6. **Add `filter_<cmd>_test.go`** with unit tests for any pure parsing/rendering function you extracted.
7. **Update both instruction packs** if the new command should be auto-rewritten by AI assistants:
   - `GOTK.md` § "Command rewrite rules" (or its equivalent section)
   - `.github/copilot-instructions.md` § "Command rewrite rules"
   Keep them in sync — they overlap intentionally.

## Output discipline

- **Reshape stdout only.** Stderr passes through; exit code passes through. Stated explicitly in `README.md` § Use.
- **Track raw vs. filtered bytes** when reshaping. Use `countReader` around the child stdout pipe and `countWriter` around your output writer (`track.go`). For pre-buffered paths (`cmd.Output()`), call `ctx.addRaw(len(out))` and `ctx.addFiltered(buf.Len())` explicitly — `filter_lint.go:runLint` is the example.
- **Strip ANSI escape codes** before parsing if the underlying tool emits color. Use `common.go:stripANSI` (regex `\x1b\[[0-9;]*[a-zA-Z]`). See `filter_gotest.go:parseGoTestOutput` which calls `stripANSI(sc.Text())` per line.

## Things to avoid

- **Don't add third-party Go dependencies.** Reflexively reach for `github.com/spf13/cobra` for the dispatcher? No — the existing `map[string]handler` is intentional. Same for any flag library, any logger, any JSON-schema lib. The whole project is a non-goal statement against the dependency-bloat default.
- **Don't introduce subpackages.** No `internal/`, no `pkg/`. The flat layout is part of the build story.
- **Don't break passthrough for unknown commands.** `main.go:88 passthrough(cmd, args)` is the fallback for any command not in the handlers map. The README documents this as a feature ("Passthrough for everything else").
- **Don't fail loudly when the analytics file can't be written.** Silent best-effort is correct here. If you need debug visibility, add a flag — don't change the default.
- **Don't reformat the README's claim about scope.** `README.md` § Scope mentions "v0.1" with a 3-filter list, but the codebase already exceeds that. Don't silently rewrite it; surface the drift to the user.
