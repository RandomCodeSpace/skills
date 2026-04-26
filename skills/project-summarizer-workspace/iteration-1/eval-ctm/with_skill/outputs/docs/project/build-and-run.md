# Build & Run

The build is non-trivial: a UI bundle must be produced first, rsynced into a Go-embeddable directory, then the Go binary built with a specific build tag. Skipping any step yields a binary that compiles but panics at boot. This file is the canonical recipe.

## Prerequisites

- **Go 1.25+** — `go.mod:3` declares `go 1.25.0`; release CI pins via `go-version-file: go.mod` (`.github/workflows/release.yml`).
- **Node + pnpm 10.33.0** — exact pnpm version pinned in `ui/package.json:packageManager`. Node version: see `ui/.nvmrc` (3 bytes — likely `22` or similar `[inferred — file is short, but not directly read]`). `@types/node` ^24 in devDependencies suggests Node 24 is supported.
- **GNU make** — `Makefile` uses `make` directives like `$(MAKE)` (`make e2e` invocation inside `regression:`).
- **rsync** — `make ui:` copies `ui/dist/ → internal/serve/dist/` via `rsync -a --delete`. macOS ships rsync; Linux distros need `apt-get install rsync` if missing.
- **C toolchain (cgo).** `mattn/go-sqlite3` requires cgo. `gcc`/`clang` + `libc` headers must be available. The release workflow cross-compiles for darwin without mingw because Windows is not a target.
- **govulncheck** — needed for `make regression` (`govulncheck ./...`). Install: `go install golang.org/x/vuln/cmd/govulncheck@latest`.
- **Playwright Chromium** — one-time: `pnpm --prefix ui exec playwright install chromium`. Cached at `~/.cache/ms-playwright`.
- **Runtime tools (not build-time):** `tmux` 3.0+, `claude` CLI on `$PATH`. See `docs/project/integrations.md`.

## First-time setup

```bash
# from repo root
go mod download
cd ui && pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # only needed for E2E
cd ..
make build
```

`make build` is `make ui` (pnpm install + vite build + rsync) + `go build -trimpath -tags sqlite_fts5 ./...`. Source: `Makefile`.

## Local development loop

```bash
make dev
```

This runs `pnpm --prefix ui dev` (Vite on :5173) **and** `go run -tags sqlite_fts5 . serve` in parallel. The Vite dev server proxies `/api`, `/events`, `/healthz`, `/health` to `127.0.0.1:37778` (`ui/vite.config.ts`). Ctrl-C tears down both via SIGINT trap (Makefile comment "Trap SIGINT so Ctrl-C tears down both").

Open the app at http://localhost:5173/ — not :37778. Hitting :37778 directly would serve the *embedded* UI bundle, which is whatever was last `rsync`'d (i.e. stale during dev).

For CLI work without the UI:

```bash
go run -tags sqlite_fts5 . <subcommand>
```

## Build tag — non-negotiable

`Makefile` line ~12 (`GO_TAGS := sqlite_fts5`) is applied to **every** `go` invocation in the Makefile. The reason is in the same comment block:

> V19 slice 3 requires SQLite FTS5. mattn/go-sqlite3 compiles FTS5 in only when the `sqlite_fts5` build tag is set; applied to every go build / test / install invocation below. Binaries built without it will panic at boot on "no such module: fts5".

If you bypass `make` (e.g. running `go test ./...` directly), pass `-tags sqlite_fts5` yourself.

## Embed-path constraint

The UI bundle must end up at `internal/serve/dist/` because Go's `//go:embed` directive rejects parent-relative paths. The `Makefile` `ui:` target does the rsync; the embed lives in `internal/serve/assets.go` (the only file with `//go:embed` per `grep -rln 'go:embed' internal/`).

Don't try to embed `ui/dist/` directly — `embed.FS` will refuse the path.

## Test layers

| Layer | Command | What it covers | Speed |
|-------|---------|----------------|-------|
| Go unit (incl. some serve integration) | `go test -tags sqlite_fts5 ./...` | All `_test.go` files in `cmd/`, `internal/...`. Most of the work. | seconds |
| Go race | `go test -race -tags sqlite_fts5 ./internal/serve/...` | Race detection on the daemon subtree. Required by `make regression`. | tens of seconds |
| Go vuln | `govulncheck ./...` | Reachable CVEs in deps. Required by `make regression`. | seconds |
| Go integration | `go test -tags 'integration sqlite_fts5' .` `[inferred tag combo]` | `integration_test.go` — spawns `./ctm` binary; some tests skip in CI or when tmux is missing. | seconds, with skips |
| UI typecheck | `pnpm --prefix ui exec tsc --noEmit` | Strict TS check (`tsconfig.app.json` + `tsconfig.node.json`). | a few seconds |
| UI unit (vitest) | `pnpm --prefix ui test` | Component + lib `.test.ts(x)` in jsdom. | a few seconds |
| UI audit | `pnpm --prefix ui audit --audit-level=high` | Block on High/Critical npm CVEs. | a few seconds |
| UI E2E (Playwright) | `make e2e` | Spec files in `ui/e2e/` against `vite preview`-served `dist/` with mocked `/api` + `/events`. | tens of seconds |

**Run-the-lot:** `make regression`. Wall time on the author's machine ~60-90s (`Makefile` comment). Fails fast on first non-zero exit.

## Build artifacts

- **Binary name:** `ctm` (one statically-linkable executable per platform).
- **What gets produced (release CI):** see `.github/workflows/release.yml`:
  - `dist/ctm-<os>-<arch>.tar.gz` for `linux/amd64`, `linux/arm64`, `darwin/amd64`, `darwin/arm64`.
  - `dist/SHA256SUMS` (GNU coreutils format — `sha256sum -c SHA256SUMS` verifies).
  - **Source tarball** with `vendor/` populated by `go mod vendor` for air-gapped builds.
  - Release notes including install-from-tarball instructions and the install-from-source `go install` command for that exact tag.
- **Local build:** `make build` produces a binary at `./ctm` (cgo-linked because of `mattn/go-sqlite3`). Trim flags: `-trimpath`. Symbol stripping happens only in CI release flow (`-ldflags "-s -w -X .../cmd.Version=$VERSION"`).
- **Version injection:** `cmd.Version` is set via ldflags in the release workflow. Local `go build` resolves via `runtime/debug.ReadBuildInfo()` and falls back to `"dev"` (`cmd/root.go:13-32`). For a custom build with a fake version: `go build -ldflags "-X github.com/RandomCodeSpace/ctm/cmd.Version=v1.2.3" -tags sqlite_fts5`.

## Release flow

Source: `.github/workflows/release.yml`.

- **Trigger:** push to `main` (auto-bumps patch) or `workflow_dispatch` with `bump=patch|minor|major`.
- **Concurrency group:** `release` (cancel-in-progress: false — releases are serialized).
- **Steps:**
  1. `actions/checkout@v4` with `fetch-depth: 0` so tags are visible.
  2. `actions/setup-go@v5` with `go-version-file: go.mod`.
  3. `go test ./...` (no `-tags` here — see Gotchas below).
  4. Compute next version from `git tag` + bump level.
  5. Generate release notes from `git log $PREV..HEAD` plus install instructions.
  6. `git tag -a "$VERSION" -m "Release $VERSION"`, `git push origin "$VERSION"`.
  7. Cross-compile binaries for the four targets with `-trimpath -ldflags "-s -w -X github.com/${REPO}/cmd.Version=${VERSION}"`.
  8. Build vendored source tarball (`go mod vendor`).
  9. `sha256sum ctm-*.tar.gz > SHA256SUMS`.
  10. `gh release create "$VERSION" --title "$VERSION" --notes-file release-notes.md dist/ctm-*.tar.gz dist/SHA256SUMS`.
- **No publishing to package registries** (no npm publish, no `crates.io`, no Docker push). Distribution is GitHub releases only.

## Deploy

There is nothing to deploy in the conventional sense — the binary is the deployable. End users:

1. `go install github.com/RandomCodeSpace/ctm@vX.Y.Z` (requires Go locally).
2. Or download the prebuilt tarball from the release page and drop `ctm` into a `$PATH` directory.
3. Run `ctm bootstrap` `[inferred command name from cmd/bootstrap.go]` for first-time setup (overlay sidecars, optional auth).

`docs/project/integrations.md` lists what the binary needs at runtime.

## Gotchas

- **Forgetting `-tags sqlite_fts5`** — see "Build tag" section. The release CI calls `go test ./...` *without* the tag (`.github/workflows/release.yml` step "Run tests"). This is a latent bug or an intentional smoke-test-only step; either way, never copy that line into local workflows. Local correctness requires the tag.
- **`go install` from `main`** — README documents this as supported but warns "main may be broken". Pinned version (`@vX.Y.Z`) is recommended.
- **`make ui` is required before `make e2e`** — Playwright runs against `vite preview` which serves the built `dist/`. `make e2e` chains `pnpm build` first; running `playwright test` directly works only if `dist/` is current. The `webServer.reuseExistingServer: !process.env.CI` in `playwright.config.ts` means CI re-spawns preview each run.
- **Stale embedded UI** — when iterating only on Go code with `make build`, the rsynced bundle is whatever you last built. After UI changes, re-run `make ui` (or `make build`).
- **Goarch / cgo cross-compile** — release CI cross-compiles to darwin from a Linux runner using stock `setup-go`, no extra cgo cross toolchain. This works because the only cgo dep (`mattn/go-sqlite3`) supports it. Don't add a new cgo dep without checking it cross-compiles for darwin/arm64 from linux/amd64.
- **`pnpm` lockfile is committed (`ui/pnpm-lock.yaml`, ~218 KB)** — the build uses `pnpm install --frozen-lockfile`. Bumping a UI dep requires regenerating the lockfile and committing it. Do not skip this for "quick fixes".
- **Windows is intentionally unsupported.** ctm depends on tmux, POSIX flock (`internal/logrotate`), and `/proc` parsing (`internal/claude/process.go`). Don't accept "make it Windows-compatible" as a small task — see `.github/workflows/release.yml` comment block confirming.
- **Embed path (`internal/serve/dist/`) must exist before Go builds.** `make ui` creates it (`mkdir -p $(EMBED_DIST)`); a clean checkout that runs `go build` directly without `make` will fail to embed. The `make build:` target enforces the order.
- **`make clean`** removes `ui/dist/` and `internal/serve/dist/`. After `make clean`, the next Go build will fail until `make ui` re-runs.
