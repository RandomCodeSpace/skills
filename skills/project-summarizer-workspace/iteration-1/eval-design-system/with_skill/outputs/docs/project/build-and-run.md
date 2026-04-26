# Build & Run

The build is small but has two non-obvious steps (CSS concatenation, tag/version verification). This file traces them.

## Prerequisites

- **Node:** `>=18.18` declared in `package.json:53`. CI uses Node 20 (`.github/workflows/ci.yml:25`, `release.yml`). No `.nvmrc` / `.tool-versions` / `mise.toml` committed `[inferred]`.
- **pnpm:** 9.x. Pinned via `"packageManager": "pnpm@9.12.0"` (`package.json:54`). CI uses `pnpm/action-setup@v4` with `version: 9`.
- **OS:** none-specific. Pure JS toolchain — no native deps.
- **Browser:** any modern one for the `preview/*.html` and `ui_kits/*/index.html` files. The `ui_kits` HTMLs additionally need outbound network access to unpkg.com (CDN-loaded React + Babel) — they fail offline.

## First-time setup

```bash
pnpm install            # respects pnpm-lock.yaml; CI uses --frozen-lockfile
```

That's it. No code generation, no submodules, no Docker.

## Local development loop

There is **no dev server**. Two ways to iterate:

1. **Type-check loop (TS):**

   ```bash
   pnpm typecheck        # tsc --noEmit
   ```

   Fast feedback on prop interfaces and component types.

2. **Visual feedback (HTML):**

   ```bash
   pnpm preview          # actually just echoes; open the file manually:
   open preview/responsive-check.html
   # or any specific card:
   open preview/components-buttons.html
   ```

   The preview HTMLs reference `../colors_and_type.css` directly — no build needed for token changes.

3. **Build loop:**

   ```bash
   pnpm build            # tsc + concatenate styles → dist/
   ```

To preview the *built* output, hand-link `dist/styles.css` from a test HTML.

## Test layers

- **Unit:** none currently. `pnpm test` runs Vitest, which finds no test files. CI step is `continue-on-error: true` (`.github/workflows/ci.yml:38`).
- **Integration:** none.
- **E2E:** none.
- **Visual regression:** none. The `preview/` HTMLs are eyeball-only.

## Build artifacts

The `pnpm build` script (`package.json:36`) does two things:

```bash
tsc -p tsconfig.build.json
# emits dist/*.js, dist/*.d.ts, dist/*.js.map, dist/*.d.ts.map (sourceMap + declarationMap on)

node -e "require('fs').writeFileSync(
  'dist/styles.css',
  require('fs').readFileSync('colors_and_type.css','utf8')
  + '\n'
  + require('fs').readFileSync('src/styles.css','utf8')
)"
# emits dist/styles.css = colors_and_type.css ⊕ src/styles.css
```

**Inputs:**

- `src/**/*.{ts,tsx}` (excluding `*.test.*`, `src/styles.css`)
- `colors_and_type.css` (project root)
- `src/styles.css`

**Outputs in `dist/`:**

- `index.js`, `index.d.ts` — package entry
- `tokens.js`, `tokens.d.ts` — token sub-path
- `components.d.ts` — declaration of every prop interface (no runtime — `.d.ts` only because the source is `.d.ts`)
- `components/*.js`, `components/*.d.ts`
- `internal/cx.js`, `internal/cx.d.ts`
- `*.js.map`, `*.d.ts.map`
- `styles.css` (concatenated)

**Published `files`** (`package.json:28`): `["dist", "src", "README.md"]`. Both `dist/` and `src/` ship — the `.npmignore` clarifies "we still ship `src/` as a fallback in `files` since users may want to read source".

**`exports` map** (`package.json:24-31`):

| Specifier | Resolves to |
|-----------|-------------|
| `@ossrandom/design-system`            | `dist/index.js` (types: `dist/index.d.ts`) |
| `@ossrandom/design-system/tokens`     | `dist/tokens.js` (types: `dist/tokens.d.ts`) |
| `@ossrandom/design-system/styles.css` | `dist/styles.css` |

`"sideEffects": ["**/*.css"]` (`package.json:29`) keeps CSS imports through tree-shaking.

## Release pipeline

Defined in `.github/workflows/release.yml`. Trigger: pushing a tag matching `v*.*.*` (e.g. `v0.1.0`, `v0.2.0-rc.1`). Manual trigger via Actions UI also supported.

### Pipeline shape (4 jobs)

1. **`build` — Build & verify.** Checks out, installs, typechecks, builds, then refuses to continue if `git tag` ≠ `v$package.json.version`. Uploads `dist/`, `package.json`, `README.md` as artifact `dist`.
2. **`publish-npm` — Publish to public npm.** Downloads artifact, sets `registry-url: https://registry.npmjs.org` and `scope: "@ossrandom"`, runs `npm publish --provenance --access public` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. Requires environment named `npm`.
3. **`publish-gpr` — Publish to GitHub Packages mirror.** Same package, registry rewritten to `https://npm.pkg.github.com`. Auth via `GITHUB_TOKEN` (auto-provided).
4. **`release` (`[inferred]` from README — workflow file truncated in survey)** — auto-generated GitHub Release with the `.tgz` tarball attached.

### Cutting a release

```bash
pnpm version patch    # 0.1.0 → 0.1.1 (also creates v0.1.1 tag)
pnpm version minor    # 0.1.0 → 0.2.0
pnpm version major    # 0.1.0 → 1.0.0

git push --follow-tags
```

`.github/RELEASING.md` contains this exact cheat sheet.

### Required secrets

`.github/SETUP.md` lists:

- **`NPM_TOKEN`** — repo secret. Required for `publish-npm`. Granular access token scoped to `@ossrandom/design-system`.
- **`GITHUB_TOKEN`** — automatic. Used by `publish-gpr` and the GitHub Release step.

Configure the `npm` environment in repo settings (recommended in SETUP.md) to gate publishing behind a manual approval if desired.

## CI

`.github/workflows/ci.yml`:

- **Triggers:** push to `main`, PR to `main`.
- **Concurrency:** `ci-${{ github.ref }}` with `cancel-in-progress: true`.
- **Steps:** checkout → pnpm 9 → Node 20 (cached via pnpm) → `pnpm install --frozen-lockfile` → typecheck → **lint** *(continue-on-error: true)* → **test** *(continue-on-error: true)* → build → upload `dist/` artifact (only on push, 7-day retention).
- **Timeout:** 12 minutes.

## Deploy

There is no application to deploy — this is a library. "Release" = npm publish (above). Consumers update via `pnpm add @ossrandom/design-system@latest`.

## Gotchas

- **Build script is a quoted JS one-liner.** `package.json:36` uses `node -e "..."`. Quotes are bash-style; if you edit it, mind the inner single-quotes around `'utf8'` and the literal `\\n` for newline-in-bash → `\n` in JS. If it grows further, extract to `scripts/build-css.mjs`.
- **CSS concatenation order matters.** `colors_and_type.css` *before* `src/styles.css` — tokens must be defined before components reference them.
- **`tsconfig.build.json:12` `exclude`** lists `src/styles.css` even though it's a `.css` file. This is defensive — TS would ignore it anyway, but the include glob is `src/**/*` so the exclude is needed `[inferred]`.
- **Tag/version drift fails the build.** If you bump `package.json` manually and forget the matching tag (or push a tag without bumping), `Verify tag matches package version` exits with `::error::Tag $TAG does not match package.json version $PKG`. Always use `pnpm version` to keep them in sync.
- **First push: read `.github/PUSH.md`** if the repo isn't yet on GitHub — it has three options for the initial push.
- **GitHub Packages publish reuses the same scope (`@ossrandom`)** as npm, only the registry URL changes. If you ever change the npm scope, you must update the release workflow's GPR job too.
- **No reproducible offline build path documented.** The repo doesn't vendor `node_modules` or document a `pnpm fetch` mirror. Adding offline support is not zero-effort — `pnpm install --offline` requires a pre-populated store.
- **Provenance.** `--provenance` (npm publish flag) requires `id-token: write` permission, which is set in `release.yml`. If you fork to a different CI provider, this needs equivalent OIDC setup.
