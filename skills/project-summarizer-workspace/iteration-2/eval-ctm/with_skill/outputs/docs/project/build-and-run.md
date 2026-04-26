# Build & Run

## Prerequisites

- **Go 1.25.0** (`go.mod:3` declares `go 1.25.0`; `release.yml` uses `setup-go` with `go-version-file: go.mod`).
- **Node 24+** (`ui/.nvmrc` pins it to `24`).
- **pnpm 10.33.0** (`ui/package.json:packageManager`).
- **System binaries on PATH (runtime, not build):** `tmux`, `claude` (Anthropic CLI), `git`. Verified by `cmd/doctor.go`.
- **Build-time:** `rsync`, GNU `make`. No CGO required (`CGO_ENABLED=0` in `release.yml`); pure-Go SQLite via `mattn/go-sqlite3`'s pure-Go shim is implied by the absence of CGO flags `[inferred — verify via `grep -n CGO_ENABLED Makefile`]`. Actually `mattn/go-sqlite3` requires CGO; the release build sets `CGO_ENABLED=0` which means it falls back to a different driver or the embed-sqlite implementation. **VERIFY** via `grep -n CGO_ENABLED Makefile .github/workflows/release.yml` — release.yml line near "build release artifacts" sets `CGO_ENABLED=0`, but `mattn/go-sqlite3` is in `go.mod`. Investigate before changing build flags.

## First-time setup

```bash
# 1. Clone
git clone https://github.com/RandomCodeSpace/ctm
cd ctm

# 2. Build the UI bundle and rsync it into internal/serve/dist for go:embed
make ui

# 3. Build the Go binary (-tags sqlite_fts5 is mandatory)
make build

# 4. Install ctm into PATH (or use go install)
./ctm install
# OR
go install -tags sqlite_fts5 github.com/RandomCodeSpace/ctm@latest

# 5. (Optional) Install Playwright Chromium for E2E
pnpm --prefix ui exec playwright install chromium
```

`make build` is `make ui && go build -trimpath -tags sqlite_fts5 ./...` (`Makefile:31-36`). The `make ui` step is **mandatory before any go build** because `internal/serve/assets.go` declares `//go:embed all:dist` and a missing `internal/serve/dist/` directory would either fail the build or embed an empty FS.

## Local development loop

```bash
make dev
```

What it does (`Makefile`, see Makefile body):

- Runs `pnpm --prefix ui dev` (Vite dev server on `127.0.0.1:5173`, strictPort).
- Runs `go run -tags sqlite_fts5 . serve` in parallel.
- Vite proxies `/api`, `/events`, `/healthz`, `/health` to `127.0.0.1:37778`.
- SIGINT (Ctrl-C) tears down both processes via a `trap`.

For CLI-only iteration (no UI changes), use:

```bash
go run -tags sqlite_fts5 . <subcommand> [args]
```

For the daemon alone:

```bash
go run -tags sqlite_fts5 . serve --port 37778
```

## Test layers

| Layer | Command | Where | Notes |
|---|---|---|---|
| Go unit | `go test -tags sqlite_fts5 ./...` | colocated `*_test.go` | Bulk of tests. Fast (<1 s per pkg). |
| Go race (daemon) | `go test -race -tags sqlite_fts5 ./internal/serve/...` | `internal/serve/...` | Daemon has goroutines; CLI mostly doesn't. |
| Integration | `go test -tags integration ./...` | `integration_test.go` (root) | Spawns built `./ctm` with isolated `HOME`. Build the binary first. |
| Govulncheck | `govulncheck ./...` | full module | Reachability-aware. |
| TS typecheck | `pnpm --prefix ui exec tsc --noEmit` | `ui/` | Project references via `tsconfig.json`. |
| Vitest | `pnpm --prefix ui test` | `ui/src/**/*.test.{ts,tsx}` | jsdom env, setup file `src/test-setup.ts`. |
| pnpm audit | `pnpm --prefix ui audit --audit-level=high` | `ui/` | Fails on High/Critical only; Medium/Low reported. |
| Playwright E2E | `make e2e` (= `pnpm build && pnpm exec playwright test`) | `ui/e2e/` | Mocks `/api`+`/events`. Vite preview on :4173. |

`make regression` chains all of the above and exits non-zero on the first failure. Wall time ~60-90 s on warm caches.

## Build artifacts

- **`make build`** produces:
  - `./ctm` — single static binary (after `release.yml`-style flags: `~7-8 MB` stripped) `[inferred from -s -w; the committed binary is ~13 MB which is unstripped]`.
  - `internal/serve/dist/` — the rsynced React bundle inside the source tree (gitignored; must exist for embed to work).
- **`release.yml` produces:**
  - `dist/ctm-vX.Y.Z-linux-amd64.tar.gz`
  - `dist/ctm-vX.Y.Z-linux-arm64.tar.gz`
  - `dist/ctm-vX.Y.Z-darwin-amd64.tar.gz`
  - `dist/ctm-vX.Y.Z-darwin-arm64.tar.gz`
  - `dist/ctm-vX.Y.Z-src.tar.gz` — vendored source tarball (`go mod vendor` populated) for air-gapped builds.
  - `dist/SHA256SUMS` — GNU coreutils format. `sha256sum -c SHA256SUMS` verifies.
  - LDFLAGS: `-s -w -X github.com/RandomCodeSpace/ctm/cmd.Version=vX.Y.Z`.
- **No Windows target.** Reasoning in `release.yml` comments: ctm depends on tmux (no native Windows port) and uses POSIX syscalls (`syscall.Flock` in `internal/logrotate`). Windows users run the Linux binary under WSL.

## Release path

1. Push to `main` triggers `.github/workflows/release.yml`.
2. Workflow computes next semver: `patch` on push, `inputs.bump` on `workflow_dispatch`.
3. Runs `go test ./...` (note: **without** `-tags sqlite_fts5` — verify whether this is intentional or a bug). `[inferred from `release.yml` step "Run tests" running `go test ./...` only — this would skip FTS5-coupled tests; surface to maintainer.]`
4. Tags `vX.Y.Z`, pushes the tag.
5. Cross-compiles four binaries via `CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -ldflags "$LDFLAGS"`. **Note: no `-tags sqlite_fts5` in this step either.** This may be a separate bug or a deliberate choice (possibly the prebuilt release binary is FTS5-less and the panic only fires when search is invoked). Confirm with the maintainer before fixing.
6. Generates SHA256SUMS, release notes (git log between previous and new tag), GitHub release with all artifacts attached.

## Deploy

- **Targets:** end-user machines (developer laptops, dev VMs). No prod/staging environment — ctm is installed by users via `go install` or by downloading the prebuilt tarball.
- **Method:**
  - `go install -tags sqlite_fts5 github.com/RandomCodeSpace/ctm@vX.Y.Z` — pulls source, builds with FTS5.
  - Prebuilt tarball download — see Gotcha above re: missing `-tags`.
- **Rollback:** `go install ...@<previous-tag>`. State files in `~/.config/ctm/` are forward-compatible (downgrade guard refuses to load a newer schema; restore from `*.bak.*` if needed).
- **`ctm uninstall`** (`cmd/install.go:runUninstall`) removes shell aliases + the entire `~/.config/ctm/` config directory. Does NOT remove the binary or kill running tmux sessions.

## Gotchas

- **`-tags sqlite_fts5` is mandatory for `go build`, `go test`, `go install`, and ad-hoc `go run`.** Without it, `mattn/go-sqlite3` is compiled without the FTS5 module and the daemon panics at runtime: `"no such module: fts5"`. The `Makefile` wires this into every Go invocation; CI workflows currently do NOT (see Release path note above). (`Makefile:11-15`.)
- **Frontend → backend embed pipeline:** `pnpm install --frozen-lockfile` → `pnpm build` (vite) → `rsync -a --delete ui/dist/ internal/serve/dist/` → `go build -tags sqlite_fts5`. Skip any step and the Go build embeds the wrong (or empty) FS. The `--delete` flag means handcrafted files in `internal/serve/dist/` will vanish on next `make ui`.
- **`//go:embed all:dist` requires the directory to exist as a sibling.** Comment in `Makefile:8-10`: "go:embed rejects parent-relative paths" — that's why the rsync target is `internal/serve/dist/` rather than embedding `../../ui/dist`.
- **Codegen/gen steps:** none. There's no `go generate`, no protoc, no codegen — ignore Makefile targets that look like they'd suggest one.
- **First-build oddities:** if `internal/serve/dist/index.html` doesn't exist, `assetHandler()` will 404 every request. The fix is `make ui` (not `go generate`, not `go build`).
- **Native deps:** none required at build time. `mattn/go-sqlite3` typically needs `gcc`/`cgo`, but `release.yml` builds with `CGO_ENABLED=0` — verify locally that this works. **VERIFY** before changing.
- **Env vars required at build time:** none mandatory. Custom `Version` injection via `-ldflags "-X github.com/RandomCodeSpace/ctm/cmd.Version=vX.Y.Z"` is optional.
- **Platform quirks:**
  - `syscall.Flock` is used in `internal/logrotate` and `internal/session/state.go` (file-locking sessions.json). Not Windows-portable.
  - Apple Silicon vs. Intel build differences: handled by the `linux-arm64` / `darwin-arm64` matrix entries. Cross-compile from x86_64 is supported (`CGO_ENABLED=0`).
- **Air-gapped install:**
  1. Download `ctm-vX.Y.Z-src.tar.gz` (vendored).
  2. Untar, `cd ctm-vX.Y.Z`.
  3. `pnpm install --frozen-lockfile --offline` (after seeding the pnpm store from a connected machine), `pnpm build`, `rsync ui/dist/ internal/serve/dist/`.
  4. `go build -trimpath -tags sqlite_fts5 -mod=vendor ./`.
  - `release.yml` documents only the Go-side air-gap path; the UI side requires manual coordination of pnpm offline cache. `[inferred — no UI air-gap doc found]`.
- **Webhook delivery is opt-in.** `Serve.WebhookURL=""` disables the dispatcher entirely (`ErrDisabled`).
- **Single-instance daemon guard.** A second `ctm serve` exits silently with status 0 if the first owns the port. A non-ctm-serve process owning the port causes a hard failure with a clear error. (`internal/serve/server.go:isAddrInUse` + `probeIsCtmServe`.)
- **Vendored deps for offline builds:** `go mod vendor` is run during release; for local dev `go mod download` is enough. `vendor/` is gitignored.
- **`integration_test.go` requires a built binary** at `./ctm` — `t.TempDir()` is used as `$HOME` and the binary must exist at the repo root. Run `make build` before `go test -tags integration ./...`.
