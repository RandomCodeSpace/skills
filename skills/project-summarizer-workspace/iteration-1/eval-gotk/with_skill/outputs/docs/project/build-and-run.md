# Build & Run

## Prerequisites

- **Go toolchain ≥ 1.22.** Pinned in `go.mod:3` (`go 1.22`). Verified building on 1.26.2 in this sandbox.
- **No system packages required** for the build itself. Zero third-party Go modules — `go.mod` has no `require` lines.
- **Wrapped tools (run-time only, optional):** `git`, `grep`, `tsc`, `eslint`, `ls`, `tree`, `find`, `docker`, `kubectl`, `cargo`, `npm`, `curl`. Each is needed only when invoking the corresponding `gotk <cmd>`. Missing tools yield exit code 127 from `common.go:execExitCode` (mapping `exec.ErrNotFound`).
- **`make` is optional.** Not required to build or install — `go install .` is sufficient.

## First-time setup

Pick one of the three install paths.

### Path A — `go install .` (recommended; per `README.md`)

```bash
git clone <repo-url> gotk
cd gotk
go install .
```

This places the binary in `$(go env GOPATH)/bin` (typically `~/go/bin`). Add that directory to `PATH` if it isn't already. Source: `README.md` § Install.

### Path B — `make build`

```bash
make build      # produces ./bin/gotk via `go build -trimpath -ldflags=-s -ldflags=-w`
```

Output: `./bin/gotk` (gitignored via `.gitignore`'s `/bin/`). Source: `Makefile` `build` target.

### Path C — `go install` from a published module (future)

```bash
go install github.com/<owner>/gotk@latest
```

Per `README.md` § Install: "needs module-proxy reachability" — won't work behind a firewall blocking `proxy.golang.org`. Local clone + `go install .` is the air-gapped path.

### Verify the install

```bash
make doctor                      # prints Go/git/grep versions + GOPATH/PATH check
gotk --version                   # → "gotk 0.1.0" (from main.go:9)
```

## Local development loop

This is a small CLI; the loop is plain Go:

```bash
go build -o /tmp/gotk .          # quick build
/tmp/gotk go test ./...          # smoke test the binary you just built
go test ./...                    # run unit tests
```

There is no watch mode, no hot reload, no multi-process orchestration. The binary itself starts in milliseconds.

## Test layers

- **Unit tests only.** No integration or E2E layer.
- **Command:** `go test ./...` (Makefile `test` target). Verified passing locally: `ok gotk 0.008s`.
- **Where they live:** colocated, one `<name>_test.go` per `<name>.go`. 9 test files total: `common_test.go`, `track_test.go`, `gain_test.go`, `filter_git_test.go`, `filter_gotest_test.go`, `filter_grep_test.go`, `filter_lint_test.go`, `filter_listing_test.go`, `filter_misc_test.go`, `filter_read_test.go`, `filter_tsc_test.go`.
- **Style:** parser functions are tested directly with `strings.NewReader(input)` — no subprocess spawning. See `filter_gotest_test.go:TestParseGoTestOutput_Failure`.
- **Single test:** `go test -run TestName` `[inferred]` — standard Go runner; not project-specific.

## Build artifacts

- **What gets produced:** a single statically linkable Go binary, `gotk`.
- **Where:**
  - `go install .` → `$(go env GOPATH)/bin/gotk`
  - `make build` → `./bin/gotk`
- **Build flags:** `Makefile` uses `-trimpath -ldflags=-s -ldflags=-w` (strips path prefixes and debug symbols / DWARF).
- **How to release:** No release automation in this repo. No `.github/workflows/`, no GoReleaser config. The repo ships source; users build their own binary. `[inferred]` from absence of release tooling.

## Deploy

- **N/A.** This is a local-machine developer tool. There is no deploy target.

## Environment variables

- `GOTK_HISTORY` — overrides the analytics file path. Default: `~/.gotk/history.jsonl`. Read in `track.go:50` (`historyPath()`). Useful for tests and for ephemeral environments.

## Gotchas

- **No `go.sum`** because there are no external dependencies. Don't be surprised by its absence.
- **`go.mod` says 1.22 but is being built with 1.26.2 in this sandbox.** Either is fine — the directive is a minimum. If you bump it, decide consciously; the project's "buildable on old toolchains" theme aligns with keeping it low.
- **`bin/gotk` is checked-in-looking but actually gitignored** (`.gitignore` has `/bin/`). It exists as a leftover from a prior `make build` and is not authoritative. Rebuild rather than trusting it.
- **No CI.** `.github/` contains only `copilot-instructions.md` (a Copilot instruction pack), not workflows. Tests are not run automatically — the next agent should run `go test ./...` before claiming a change is good.
- **No commits in this repo yet.** `git log` errors with "your current branch 'main' does not have any commits yet". All files are untracked. Any changes you make will become the first commit. Set `.gitignore` is already in place — safe to `git add .` for an initial import.
- **Stripped binary, no symbols.** If you need to debug a built `bin/gotk`, rebuild with `go build -o bin/gotk .` (no `-ldflags=-s -ldflags=-w`) so stack traces are useful.
