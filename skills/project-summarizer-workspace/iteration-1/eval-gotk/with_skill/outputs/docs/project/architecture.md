# Architecture

## High-level shape

`gotk` is a single-process CLI dispatcher. `main.go` reads `os.Args[1]`, looks it up in a `map[string]handler` (`main.go:13`), and invokes the matching `runX` function. Each handler shells out to the underlying tool via `os/exec`, reshapes stdout, and returns the child's exit code. Unknown commands fall through to a transparent passthrough (`common.go:passthrough`). There is no library, no daemon, no IPC — just dispatch + per-command filters + a small append-only analytics log.

```
                           +----------------+
   os.Args  ───────────►   |   main.main    |
                           |  (dispatch)    |
                           +-------+--------+
                                   |
              ┌────────────────────┼─────────────────────┐
              ▼                    ▼                     ▼
   +-------------------+   +-----------------+   +----------------+
   | filter_*.go runX  |   | runGain (gain)  |   | passthrough()  |
   | wraps real tool   |   | reads JSONL     |   | unknown cmds   |
   | reshapes stdout   |   | history file    |   |                |
   +---------+---------+   +-------+---------+   +----------------+
             │                     │
             ▼                     ▼
        os/exec child         ~/.gotk/history.jsonl
        (git, go, grep, ...)  (append-only, JSON-per-line)
```

## Components

### Dispatch (`main.go`)

- **Lives in:** `main.go`
- **Responsibility:** Parse `os.Args`, handle `--help`/`--version`, look up the handler, invoke it, exit with its return code.
- **Key files:** `main.go` — `handlers` map (line 13), `usageText` (line 30), `main()` dispatch (`main.go:71-89` `[inferred]` line range; the `switch`/lookup/exit pattern is small and bounded).
- **Talks to:** All `filter_*.go` handlers, plus `passthrough()` from `common.go`.
- **Owns:** the registry of supported commands.

### Shared helpers (`common.go`)

- **Lives in:** `common.go`
- **Responsibility:** Cross-cutting primitives every filter uses.
- **Key files:** `common.go` — `passthrough(name, args)` (full transparent exec, all three streams piped), `execExitCode(err)` (maps `error` → POSIX exit code: `nil`→0, `exec.ErrNotFound`→127, `*exec.ExitError`→its code, else 1), `stripANSI(s)` (regex `\x1b\[[0-9;]*[a-zA-Z]`).
- **Talks to:** Used by every filter; no upstream calls.

### Analytics tracking (`track.go`)

- **Lives in:** `track.go`
- **Responsibility:** Counts raw bytes pulled from the child's stdout vs. filtered bytes written to the user's stdout for each invocation, and appends a JSONL event to a history file when the command finishes.
- **Key files:** `track.go` — `runCtx` struct + `startRun(cmd)` constructor; atomic `addRaw`/`addFiltered` (atomic so multi-goroutine paths are safe — currently nobody uses goroutines, but the discipline is there); `runEvent` JSON shape `{ts, cmd, raw, filtered, ms, exit}`; `historyPath()` (env `GOTK_HISTORY` overrides `~/.gotk/history.jsonl`); `appendEvent` (best-effort, swallows all errors); `countReader` and `countWriter` (decorators that increment counters as bytes pass through).
- **Talks to:** Filesystem (`~/.gotk/history.jsonl`).
- **Owns:** the JSONL history file.

### Analytics renderer (`gain.go`)

- **Lives in:** `gain.go`
- **Responsibility:** Read the JSONL history, group by command, render a savings table.
- **Key files:** `gain.go` — `runGain(args)` opens the history file (gracefully reports "No gotk history yet" on `os.IsNotExist`); `renderGain(r, w)` decodes one event per line into `gainStat{count, raw, filtered, ms}`, computes saved bytes and percentage; reused by tests via `bytes.Buffer`.
- **Talks to:** Filesystem (read-only).

### Filters (`filter_*.go`)

Each filter is a self-contained command handler. Naming convention: `filter_<command>.go` ↔ `filter_<command>_test.go`. The handler symbol is `runX(args []string) int`.

| File | Handler(s) | Strategy |
|------|-----------|----------|
| `filter_git.go` | `runGit` (+ `runGitCmd`, `gitDiff`) | Always prepend `--no-pager -c color.ui=never`. Per-subcommand defaults: `status` → `-s`, `log` → `--oneline -20`, `branch` → `--list`. `git diff` is special: capture all output; if ≤300 lines emit verbatim, else emit `--stat` summary. |
| `filter_gotest.go` | `runGo` | If args don't start with `test`, passthrough. If `-json`/`-test.v=json` is present, passthrough (preserves machine-readable output). Else: stream stdout through `parseGoTestOutput` which extracts `--- FAIL:` blocks and `ok/FAIL/?` package summaries; print only failures + pass/skip counts. |
| `filter_grep.go` | `runGrep` | Force `--color=never`. If user passed format-changing flags (`-l`, `-c`, `-q`, etc. — see `grepHasFormatChangingFlag`), passthrough. Else: read child stdout, split each line on the first `:` to get filename, group by file, cap at 25 hits/file and 200 hits total; render grouped output. |
| `filter_lint.go` | `runLint` | Special early-return for `--help`/`--version`. If user already supplied `--format`, line-cap passthrough at 500. Else: force `--format=json`, capture full child output, `json.Unmarshal` into `[]eslintFile`, group `messages` by `ruleId`, sort by total count desc, render top-5 locations per rule. Severity 2 → `err`, else `warn`. |
| `filter_listing.go` | `runLs`, `runTree`, `runFind` | Thin wrappers over `execWithLineCap`. `runLs` forces `--color=never` (cap 100). `runTree` forces `-L 3 --charset=ascii --noreport -n` unless overridden (cap 300). `runFind` is a plain line-cap (200). |
| `filter_misc.go` | `runDocker`, `runKubectl`, `runCargo`, `runCurl`, `runNpm` | Line-cap passthroughs. `runNpm` additionally strips funding/notice noise via `npmNoiseREs` regex set and `execWithLineCapSkipping`, which counts skipped lines and emits `[gotk] N noise lines stripped`. Caps: docker/kubectl/cargo 300, npm/curl 200. |
| `filter_read.go` | `runRead` | Custom file-reader (not a passthrough). Parses `--all`, `--raw`, `--max-lines N`, `--max-chars N`. `--raw` falls back to `cat`. Otherwise opens the file directly, adds line numbers, collapses runs of blank lines, truncates lines > `maxChars` (default 200), caps at `maxLines` (default 500). Stat'd file size is recorded as `raw` for analytics. |
| `filter_tsc.go` | `runTSC` | Early passthrough on `--watch`/`-w`/`--help`. Else stream child stdout, match each line against `^(.+?)\((\d+),(\d+)\):\s+error\s+TS(\d+):\s+(.+)$`, group by TS code, sort groups by count desc, render top-5 locations per code. |

## Layering / dependency rules

- All files are in `package main` at the repo root. No layering, no internal packages.
- The de facto layering is: `main.go` calls `filter_*.go` calls `common.go`/`track.go`. `gain.go` reads the file `track.go` writes; they're decoupled through the JSONL format.

## Cross-cutting concerns

- **Logging:** none. The tool prints to stderr on its own errors using `fmt.Fprintln(os.Stderr, "gotk:", err)` (e.g. `filter_git.go`, `filter_misc.go`). No structured logger.
- **Error handling:** Errors are mapped to POSIX exit codes via `common.go:execExitCode`. Filters never `panic`. The history-write path swallows all errors silently — analytics must never break a real command.
- **Auth / authz:** N/A. Local CLI; no credentials handled.
- **Observability:** Self-observation only — every reshaping invocation appends a `runEvent` to `~/.gotk/history.jsonl`. `gotk gain` is the report.
- **Config:** One env var: `GOTK_HISTORY` (overrides history file path; `track.go:50`). No config file.

## Why it's shaped this way

`README.md` § "Why this exists" and `GOTK.md` § "Install on restricted machines" make it explicit: the project targets environments where you cannot install third-party binaries and must build from source. That constraint forces:

- Stdlib-only Go (`go.mod` is intentionally empty — `README.md`: "No third-party dependencies").
- Flat single-package layout (no monorepo overhead, no extra Go modules to vendor).
- A small, additive surface — each filter is one file you can read end-to-end. The README explicitly says it ships only "the three filters that account for the majority of real-world token savings in Go-heavy codebases" — though the actual code now has 8+ filter files; the project has expanded beyond the v0.1 scope claim in `README.md` § Scope.

There are no ADRs or commit messages (the repo has no commits yet — see Gotchas in `PROJECT_SUMMARY.md`).
