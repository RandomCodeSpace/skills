# Architecture

## High-level shape

A single-binary CLI dispatcher. `main()` reads `os.Args[1]`, looks it up in a `map[string]handler` (`main.go:13-29`), and calls the matching `run<Tool>(args)` function. Each handler `exec.Command`s the underlying tool (`go`, `git`, `grep`, etc.), pipes its stdout through a tool-specific reshape function, and returns the child's exit code. Unknown commands fall through to `passthrough()` (`common.go:11`) which `exec`s the raw command with stdin/stdout/stderr hooked up unchanged.

There are no goroutines beyond what the stdlib `exec.Cmd` machinery uses, no global state beyond the `handlers` map and the JSONL history file, and no concurrency-safety concerns — each invocation is a fresh process.

```
                       +--------------+
   user shell  ----->  | gotk <cmd>   |
                       | (one-shot)   |
                       +------+-------+
                              |
                              v
                  +-----------+----------+
                  | main.go: handlers map|
                  | dispatch on os.Args  |
                  +-----+----------+-----+
                        |          |
                        | known    | unknown
                        v          v
        +---------------+---+   +---------------+
        | filter_<tool>.go  |   | passthrough() |
        | startRun -> exec  |   | exec verbatim |
        | parse / cap / fmt |   +-------+-------+
        | ctx.finish(exit)  |           |
        +---------+---------+           |
                  |                     |
                  +----------+----------+
                             v
                +------------+------------+
                | os.Stdout / os.Stderr   |
                | + ~/.gotk/history.jsonl |
                +-------------------------+
```

## Components

### Dispatcher

- **Lives in:** `main.go`
- **Responsibility:** Argv routing. Map verb → handler; print usage on `-h`/`--help`; print version on `-v`/`--version`; fall through to passthrough on unknown verb.
- **Key files:** `main.go:13-29` (`handlers` map), `main.go:31-60` (`usageText`), `main.go:62-81` (`main`).
- **Talks to:** Each `run<Tool>` function via direct call.
- **Owns:** The list of recognized verbs.

### Common helpers

- **Lives in:** `common.go`
- **Responsibility:** Cross-filter utilities used by every handler.
- **Key files:**
  - `common.go:8` `stripANSI` — single regex `\x1b\[[0-9;]*[a-zA-Z]`. Used where a parser must tolerate colorized child output.
  - `common.go:11` `passthrough(name, args)` — exec child with stdio hooked up; returns exit code.
  - `common.go:18` `execExitCode(err)` — `nil → 0`, `exec.ErrNotFound → 127`, `*exec.ExitError → ee.ExitCode()`, else `1`. The single source of truth for exit-code propagation.
- **Owns:** Nothing.

### Tracking & analytics

- **Lives in:** `track.go`, `gain.go`
- **Responsibility:** Append a `runEvent` per invocation to `~/.gotk/history.jsonl` (`track.go`); summarize that file with `gotk gain` (`gain.go`).
- **Key files:**
  - `track.go:11-15` `runCtx` — `cmd, raw, filtered (atomic int64), start time`.
  - `track.go:21-28` `runEvent` — JSONL schema: `ts, cmd, raw, filtered, ms, exit`.
  - `track.go:38-46` `historyPath` — `$GOTK_HISTORY` env override → `$HOME/.gotk/history.jsonl`.
  - `track.go:48-72` `appendEvent` — best-effort: silently skips on any I/O error so history failures never crash a tool run.
  - `gain.go:runGain` — opens the file, decodes line by line, aggregates into a `byCmd map[string]*gainStat` plus a `total`, prints saved bytes + percent + per-command breakdown.
- **Talks to:** Filesystem only. Never the network.
- **Owns:** The JSONL file format. **Schema-stability matters** — any change here breaks `gain` for users with existing history.

### Filters (one file per wrapped tool)

Each filter is a `run<Tool>(args []string) int` that:

1. Optionally short-circuits to `passthrough` for incompatible flags (`--watch`, `--json`, etc.).
2. Calls `startRun("<label>")` to begin tracking.
3. Builds an `exec.Command`, pipes stdout, leaves stderr connected to `os.Stderr`.
4. Runs a tool-specific reshape (parse / regroup / cap).
5. Calls `ctx.finish(exit)` and returns the child's exit code.

Strategies in use:

| File | Verb(s) | Strategy |
|---|---|---|
| `filter_gotest.go` | `go test` | Stream-parse `--- FAIL: / --- PASS: / --- SKIP:` and per-package `ok\t / FAIL\t` lines; emit only failures + counts. Falls through to passthrough when `-json` flag is set. |
| `filter_git.go` | `git <sub>` | Inject `--no-pager -c color.ui=never`; per-subcommand smart defaults (`status -s -b`, `log --oneline -20`, `branch --list`); `diff` runs full diff and swaps to `--stat` if >300 lines. |
| `filter_grep.go` | `grep` | Force `-n --color=never`; group hits by file; 200 total / 25 per-file caps. Format-changing flags (`-l/-L/-c/-q/-o/-Z`) bypass to plain passthrough with `--color=never`. |
| `filter_tsc.go` | `tsc` | Regex `^(.+?)\((\d+),(\d+)\):\s+error\s+TS(\d+):\s+(.+)$` → group by code, top-5 locations per code. Merges stderr into stdout (intentional). |
| `filter_lint.go` | `lint` (eslint) | Force `--format=json`, parse JSON, group by `ruleId`, render summary. Bypasses to `execWithLineCap` cap=500 if user already passed `--format/-f`. |
| `filter_read.go` | `read <file>` | Read a local file with line numbers, collapsing consecutive blank lines, truncating long lines. Flag-driven: `--all --raw --max-lines N --max-chars N`. Default 500 lines / 200 chars. |
| `filter_listing.go` | `ls`, `tree`, `find` | Generic line-cap helper `execWithLineCap` (also exported to misc.go). `tree` injects `-L 3 --charset=ascii --noreport -n` if not already present. |
| `filter_misc.go` | `docker`, `kubectl`, `cargo`, `curl`, `npm` | Mostly thin wrappers around `execWithLineCap` / `execWithLineCapSkipping`. `npm` strips funding/notice noise via three regexes. |
| `gain.go` | `gain` | Pure local-file reader — does not exec anything. |

## Layering / dependency rules

There is no formal layering — everything is `package main`. The de facto rules:

- **Filters depend on `common.go` and `track.go`.** Not the other way around.
- **`main.go` references every filter** (via the `handlers` map). It's the only file that imports across — though "imports" here is just same-package symbol use.
- **No filter imports another filter.** `filter_listing.go`'s `execWithLineCap` and `execWithLineCapSkipping` are reused by `filter_misc.go` only because they live in the same package; this is the closest the code gets to a shared abstraction.

## Cross-cutting concerns

- **Logging:** None. There is no logger. Errors from gotk itself (not the wrapped tool) are emitted as `fmt.Fprintln(os.Stderr, "gotk:", err)`. Wrapped-tool stderr is forwarded verbatim.
- **Error handling:** Plain `error` values. `execExitCode()` (`common.go:18`) is the single helper for converting `exec` errors to shell exit codes. Filters never `panic`.
- **Config:** One env var, `GOTK_HISTORY` (`track.go:39`). No config files. Caps and defaults are package-level constants at the top of each `filter_*.go`.
- **Observability:** Per-invocation `runEvent` to `~/.gotk/history.jsonl`. `gotk gain` is the only consumer.
- **Concurrency:** None within a single invocation beyond stdlib `exec.Cmd`. `runCtx` uses `sync/atomic` (`track.go:18-19`) defensively, but in practice `addRaw` / `addFiltered` are called from a single goroutine.

## Why it's shaped this way

Stated rationale (verbatim sources):

- **Zero deps + flat layout:** `README.md` "Install" — *"No third-party dependencies. `go.mod` has zero `require` lines. Builds offline from a cloned tree."* `GOTK.md` "Install on restricted machines" — *"Requires only the Go toolchain. Zero third-party deps in `go.mod`."* The constraint is environments where you cannot install or download arbitrary binaries — only build from source, only stdlib.
- **One filter per file:** `[inferred]` — not stated explicitly anywhere. The pattern is consistent enough across 9 filter files that it's clearly intentional. Verify via `ls /home/dev/projects/gotk/filter_*.go`.
- **No hooks / passive integration:** `GOTK.md` "Non-goals for v0.1" — *"Hooks for any assistant. This tool is instruction-driven on purpose — it runs because the model chose to run it."* The CLI is invoked because Copilot / Claude / Cursor was told (via `GOTK.md` or `.github/copilot-instructions.md`) to prefer `gotk <cmd>` over the raw command. No shell aliases, no PATH shadowing, no auto-rewrites.
- **Only stdout reshaped; stderr + exit code verbatim:** `README.md` "Use" — *"Exit codes and stderr are preserved. Only stdout is reshaped."* `.github/copilot-instructions.md` "Exit codes and semantics" reiterates. This is the *contract* with consumers — non-negotiable.
