# Build & Run

## Prerequisites

- **Go:** 1.25.0 (pinned in `go.mod:3`). CI uses `go-version-file: go.mod`.
- **Node:** version in `ui/.nvmrc` `[inferred]` from file presence — verify via `cat ui/.nvmrc`.
- **pnpm:** 10.33.0 (pinned in `ui/package.json` `packageManager` field).
- **System:** `tmux`, `claude` (Claude Code CLI), `git`, `rsync`, `make`. Validated by `ctm doctor` / `ctm check`.
- **Optional:** Chromium for Playwright E2E (`pnpm --prefix ui exec playwright install chromium`).
- **Build constraint:** `mattn/go-sqlite3` requires CGO. `CGO_ENABLED=1` (default for native builds).

## First-time setup

```bash
git clone https://github.com/RandomCodeSpace/ctm.git
cd ctm

# Build the UI bundle first (rsync's into internal/serve/dist for go:embed)
make ui

# Build the binary (depends on `make ui`)
make build

# (Optional) one-time E2E browser install
pnpm --prefix ui exec playwright install chromium
```

Source: `Makefile` help target lists every entry point; commands above are exact `make` invocations.

## Local development loop

```bash
make dev
```

Internally this runs `pnpm --prefix ui dev` (Vite at `:5173`, proxies `/api` `/healthz` `/health` `/events` → `127.0.0.1:37778`) and `go run -tags sqlite_fts5 . serve` in parallel, with a `trap` to tear both down on Ctrl-C. Source: `Makefile`.

For backend-only iteration: `go run -tags sqlite_fts5 . serve` and hit `http://127.0.0.1:37778`.

## Test layers

- **Unit (Go):** `go test -tags sqlite_fts5 ./...` — fast, ~25 `*_test.go` files. Race: add `-race`.
- **Integration (Go):** `integration_test.go` at repo root — cross-package smoke. Same command picks it up.
- **Property (Go):** `internal/session/state_property_test.go` — sessions.json round-trips.
- **UI unit (Vitest):** `pnpm --prefix ui test` (`vitest run --passWithNoTests`).
- **UI E2E (Playwright):** `make e2e`. 18 specs in `ui/e2e/`. Mocks `/api` + `/events` at page level; no daemon required. Uses Chromium from `~/.cache/ms-playwright`.
- **Pre-merge full pack:** `make regression`. Runs go build + test + race + vuln + ui tsc + vitest + audit + e2e. Fails fast on first non-zero. ~60–90s wall time on a warm cache.

## Build artifacts

- **What gets produced:** Single static binary `./ctm` (~14 MB stripped — observed from root listing). UI is `//go:embed`'d.
- **Where:** Repo root for `go build`. Release archives produced by `.github/workflows/release.yml` on tag push.
- **Release archives:**
  - Per-OS/arch tarballs: `ctm-${VERSION}-darwin-amd64.tar.gz`, `darwin-arm64`, `linux-amd64`, `linux-arm64` `[inferred]` from release notes template.
  - Air-gapped source: `ctm-${VERSION}-src.tar.gz` — vendored source tree (`go mod vendor` populated). Rebuilds offline with `go build -tags sqlite_fts5 .`.

## Deploy

- **Targets:** Local-only. ctm binds `127.0.0.1:37778` and is meant to run on the developer's machine.
- **Distribution:** GitHub Releases (artifacts above) + `go install github.com/RandomCodeSpace/ctm@vX.Y.Z`. README `Installation` documents both.
- **Auto-spawn:** `proc.EnsureServeRunning` lazy-spawns `ctm serve` from any attach/new/yolo invocation. Single-instance enforced via `X-Ctm-Serve` header probe on `/healthz`.
- **Rollback:** Replace the binary with the prior tag. State files (`~/.config/ctm/{config,sessions,user}.json`) carry `schema_version` + `.bak.<unix-nano>` rotation; downgrade by restoring a backup.

## Release workflow

`.github/workflows/release.yml` (verified — read in full):

1. Checkout with full history + tags.
2. `actions/setup-go@v5` reading `go-version-file: go.mod`.
3. `go test ./...` (note: NOT tagged with `sqlite_fts5` in CI as of HEAD — could surface FTS5 build/test issues post-merge — verify in `release.yml`).
4. Compute next version via SemVer bump (default `patch` on push to main, configurable on workflow_dispatch).
5. Generate release notes from `git log` between previous tag and HEAD.
6. Tag + push + create GitHub Release with archives.

There is **no PR-validation workflow** in `.github/workflows/`. Verified by `ls .github/workflows/`. Pre-merge gate is local: `make regression`.

## Gotchas

- **`-tags sqlite_fts5` is mandatory.** Build, test, install — every Go invocation. Missing it: binary boots, takes traffic, panics on first FTS5 query. Source: `Makefile` comment block lines 1–8 of the tag definition.
- **`make ui` is a hard prerequisite for `go build`.** First clean clone needs `make ui` once before `go build` succeeds; the embed target dir must exist with content. The Makefile's `build` target wires `ui` as a dependency, but bare `go build` does not.
- **UI assets are sibling-rsync'd, not symlinked.** `//go:embed` rejects parent-relative paths, so `ui/dist/` is mirrored into `internal/serve/dist/` via `rsync -a --delete`. Don't replace with a symlink — embed walks resolved paths.
- **CGO required.** `mattn/go-sqlite3` is C. Cross-compiling needs a cross-compile toolchain — ctm doesn't currently script this. Single-arch builds only without toolchain setup.
- **Vite proxy must not buffer or gzip `/events`.** SSE is HTTP/1.1 keep-alive; gzip breaks the stream. Default Vite http-proxy config passes through; don't change it.
- **`pnpm install --frozen-lockfile` is required offline.** The Makefile `ui` target uses `--frozen-lockfile`; mismatched lockfile fails the build. Don't `pnpm install` without `--frozen-lockfile` inside CI.
- **Playwright Chromium isn't bundled.** First-time E2E run needs `pnpm --prefix ui exec playwright install chromium`. Install dir: `~/.cache/ms-playwright`. Don't `npx playwright install --with-deps` — that wants apt.
- **CI runs `go test` without the FTS5 tag.** As of HEAD, `release.yml` job step "Run tests" is `go test ./...`. This means FTS5-touching tests (`internal/serve/store/*_test.go`) are skipped or fail in CI but pass locally. Worth raising as follow-up; not addressed here. Verified by reading the workflow YAML.
- **`schema_version` newer than known fails startup hard.** No silent downgrade. If a user runs an older binary against newer state files, they'll see refusal. Tell users to keep state files versioned.
- **YOLO checkpoint commits flood `git log`.** Filter when summarizing recent activity: `git log --invert-grep --grep='^checkpoint'`.
- **`integration_test.go` at repo root.** Don't move into a subpackage — Go's `go test ./...` picks it up at root.

## Reproducible offline builds

The release pipeline produces `ctm-${VERSION}-src.tar.gz` containing a vendored tree (`go mod vendor`). Behind a corporate firewall:

1. Extract the tarball.
2. `make ui` requires the `pnpm` registry mirror configured (see your internal mirror docs `[inferred]`).
3. `make build` runs `go build` against the vendored tree — no public-internet calls.

Caveat: `make ui` still needs a pnpm mirror. The Go side is fully offline once vendored.
