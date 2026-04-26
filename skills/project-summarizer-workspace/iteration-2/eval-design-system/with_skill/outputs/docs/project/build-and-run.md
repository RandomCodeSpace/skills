# Build & Run

This is genuinely non-trivial despite the repo's small size: dual-registry publish with a tag/version-sync gate, an in-build CSS concatenation step, and CI that currently has soft-fails on lint and test. The full pipeline is documented below.

## Prerequisites

- **Node:** `>=18.18` (`package.json:engines`). CI uses Node 20 (`.github/workflows/ci.yml:25`).
- **pnpm:** 9.x — pinned via `package.json:packageManager = "pnpm@9.12.0"`. Use Corepack or install pnpm 9 globally; npm/yarn are not supported by the tooling.
- **System packages:** none. No native deps, no `protoc`, no codegen.
- **Docker:** not required.

## First-time setup

From `.github/SETUP.md` and `package.json:scripts`:

```bash
# 1. Install dependencies (frozen lockfile, like CI)
pnpm install --frozen-lockfile

# 2. Verify the toolchain works
pnpm typecheck   # tsc --noEmit
pnpm build       # produces dist/
```

## Local development loop

```bash
pnpm typecheck       # fastest signal — strict TS
pnpm lint            # eslint src/**/*.{ts,tsx}  (no-op today; no eslint config)
pnpm test            # vitest run (no-op today; no test files)
pnpm build           # full build to dist/
pnpm preview         # echoes "Open preview/responsive-check.html in a browser"
```

There is **no dev server, no HMR, no watch mode** declared in `package.json`. To iterate visually:

1. Run `pnpm build` once.
2. Open `preview/responsive-check.html` directly in a browser — it iframes the 39 `preview/components-*.html` cards across simulated device viewports.
3. For full layouts, open `ui_kits/marketing/index.html` (or `app/`, `docs/`) — these load React + Babel from unpkg at runtime and render in-browser. **Requires internet access** (CDN scripts).

## Test layers

- **Unit:** `pnpm test` runs vitest. **Zero test files exist** (verify: `find src -name '*.test.*' -o -name '*.spec.*'` → empty).
- **Integration:** none.
- **E2E:** none.
- **Visual QA:** manual, via `preview/*.html` (39 design-gallery cards) and `ui_kits/*/index.html` (3 reference layouts). Not automated.
- **a11y:** no automated check.

If you're adding the first test:
- vitest is already in `devDependencies`. Default config (no `vitest.config.*` exists) — vitest will pick up `*.test.ts(x)` colocated with sources.
- Remove `continue-on-error: true` from the test step in `.github/workflows/ci.yml:40` once a real test exists, or the green CI status is meaningless.

## Build artifacts

Running `pnpm build` produces `dist/` with:

- `dist/index.js` — ESM bundle (re-export only; one file per family is preserved as separate `.js` files because `tsc` mirrors the `src/` tree)
- `dist/index.d.ts`, `dist/tokens.d.ts`, `dist/components.d.ts` — type declarations
- `dist/*.js.map`, `dist/*.d.ts.map` — source maps + declaration maps (`tsconfig.json:sourceMap: true, declarationMap: true`)
- `dist/styles.css` — `colors_and_type.css` + `src/styles.css` concatenated by the inline Node script in `package.json:scripts.build`

The `package.json:exports` map only routes consumers to:
- `"."` → `dist/index.{js,d.ts}`
- `"./tokens"` → `dist/tokens.{js,d.ts}`
- `"./styles.css"` → `dist/styles.css`

Other emitted files exist on disk but are not part of the public surface. [inferred — verified via `package.json:exports`]

## CI

`.github/workflows/ci.yml` runs on push to `main` and PRs to `main`:

```
checkout → setup pnpm@9 → setup Node 20 → pnpm install --frozen-lockfile
   → typecheck   (hard fail)
   → lint        (continue-on-error)
   → test        (continue-on-error)
   → build       (hard fail)
   → upload dist artifact (push events only, retained 7 days)
```

Job timeout: 12 minutes. Concurrency group cancels in-progress runs on the same ref.

**Important:** the lint and test steps are soft-fails (`continue-on-error: true`, lines 36 and 40). A green CI today means typecheck + build succeeded, NOT that tests or lint passed. Remove these flags once eslint config + tests land.

## How to release

Quick path (from `README.md > Releases`):

```bash
pnpm version minor       # bumps package.json + creates v0.2.0 tag
git push --follow-tags
```

What happens behind the scenes (`.github/workflows/release.yml`):

1. **`build` job** — checkout the tag, install, `pnpm run typecheck && pnpm run build`, then **verify `git tag` (`vX.Y.Z`) matches `package.json:version`**. Hard-fails if mismatched. Uploads `dist/` + `package.json` + `README.md` as artifact.
2. **`publish-npm` job** (env: `npm`) — downloads artifact, sets registry to `https://registry.npmjs.org`, runs `npm publish --provenance --access public`. Auth via `NPM_TOKEN` secret.
3. **`publish-gpr` job** (env: `github-packages`) [inferred env name — actual env name not verified] — downloads artifact, sets registry to `https://npm.pkg.github.com`, **mutates `package.json:publishConfig` in-place via inline Node** to point at GPR, then `npm publish`. Auth via the auto-provided `GITHUB_TOKEN`.
4. **`github-release` job** — packs the artifact into `.tgz` via `npm pack`, then `softprops/action-gh-release@v2` creates a Release with auto-generated notes and the `.tgz` attached.

Both publish jobs need the `build` job to succeed; the GitHub Release waits on both publishes.

## Required secrets

From `.github/SETUP.md:2`:

| Secret | Where it's used | How to provision |
|---|---|---|
| `NPM_TOKEN` | `publish-npm` job | npmjs.com → Access Tokens → Granular → "Publish for @ossrandom" |
| `GITHUB_TOKEN` | `publish-gpr` and `github-release` jobs | Auto-provided by GitHub Actions; no setup needed |

## Rollback

From `.github/SETUP.md > Rollback`. [Inferred — content not exhaustively read for this summary; consult the file directly for the npm-deprecate / unpublish-window specifics before any rollback action.]

## Gotchas

- **The build's CSS concat is a `node -e` one-liner** (`package.json:scripts.build`):
  ```
  tsc -p tsconfig.build.json && node -e "require('fs').writeFileSync('dist/styles.css', require('fs').readFileSync('colors_and_type.css','utf8') + '\n' + require('fs').readFileSync('src/styles.css','utf8'))"
  ```
  Renaming either CSS file silently breaks `dist/styles.css`. If you split the concat into a real script, keep it equally simple — no toolchain creep.
- **`tsconfig.build.json:exclude` lists `src/styles.css`** even though `tsc` would skip it anyway. The exclude is a load-bearing reminder that styles ship via the concat step.
- **No `vitest.config.*` exists** — verify with `ls vitest* vite*` (returns nothing). vitest will use defaults; you'll need to add a config when introducing JSX-aware tests (e.g. for `jsdom`).
- **No `.eslintrc*` / `eslint.config.*` exists** — verify with `ls .eslintrc* eslint.config.*`. The `lint` script will eventually fail loudly when an eslint 9 flat-config file is added without `eslint` already being able to find it.
- **Release publishes from the artifact, not from source** — `publish-npm` and `publish-gpr` jobs use `actions/download-artifact@v4`, not `actions/checkout`. The `dist/`, `package.json`, and `README.md` shipped come from the `build` job's output.
- **GPR job mutates `package.json` in the runner** before publishing — this rewrite is purely in the runner's filesystem; the repo's `package.json` is unchanged. Don't be alarmed by the inline Node script.
- **Tag format must be `vX.Y.Z` or `vX.Y.Z-…`** — release workflow trigger is `tags: - "v*.*.*"` (`.github/workflows/release.yml`). A tag like `0.2.0` (no `v` prefix) won't trigger anything.
- **Don't try to publish manually with `npm publish`** — it would skip the tag/version-sync gate, the provenance flag, and the GPR mirror. Always go through the workflow.
- **`prepublishOnly` script** runs `pnpm run typecheck && pnpm run build`. This protects local `npm publish` invocations but doesn't substitute for the CI-side tag-vs-version check.
- **First-build oddities:** none observed — clean clone → `pnpm install --frozen-lockfile` → `pnpm build` works in one pass per the `ci.yml` flow.
- **Air-gapped builds:** `pnpm install --frozen-lockfile` resolves from the lockfile but still hits the configured registry on a clean install. For an air-gapped pipeline, mirror the registry (Verdaccio/Sonatype Nexus) and override via `.npmrc`.
- **`ui_kits/*/index.html` runtime CDN deps** — these reference `unpkg.com` for React/React-DOM/Babel/lucide. They will not run offline. They are not part of the build, not part of the published package, and not gated by CI.
