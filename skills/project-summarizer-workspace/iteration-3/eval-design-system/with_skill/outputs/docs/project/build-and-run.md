# Build & Run

## Prerequisites

- **Node:** `>=18.18` (`package.json:53`). CI uses `node-version: 20` (`.github/workflows/ci.yml:18`).
- **pnpm:** `9.12.0` is the declared `packageManager`. CI uses pnpm 9 (`.github/workflows/ci.yml:14`).
- **OS / native deps:** none. Pure JS toolchain.

## First-time setup

```bash
pnpm install --frozen-lockfile
```

Source: `.github/workflows/ci.yml:24`. Lockfile is `pnpm-lock.yaml` (committed).

## Local development loop

There is **no watch mode and no dev server**. The library is a `tsc`-built package; the iteration loop is:

```bash
pnpm typecheck    # tsc --noEmit
pnpm build        # emits dist/ with .js, .d.ts, source/declaration maps, and dist/styles.css
```

For visual checks, open one of the 38 HTML cards in `preview/` directly in a browser, or open `preview/responsive-check.html` (an iframe viewer with a device-dimension picker). `pnpm preview` (`package.json:41`) just `echo`s the hint — it does not start a server.

Note: the `preview/` cards reference `colors_and_type.css` and use **static HTML** with `.rcs-*` classes, not the live React components. They test CSS, not component logic.

## Test layers

- **Unit:** Vitest 2 declared (`package.json:53`). **Zero tests in the repo today** — verify via `find . -name '*.test.*' -not -path '*/node_modules/*'`. CI calls `pnpm run test` with `continue-on-error: true` (`.github/workflows/ci.yml:38`).
- **Integration / E2E:** none.
- **Visual:** manual, via `preview/` HTML cards.

When you add the first test, plan to remove `continue-on-error: true` from the CI step in the same PR — otherwise broken tests will silently pass green.

## Build artifacts

`pnpm build` runs (`package.json:37`):

```bash
tsc -p tsconfig.build.json && \
node -e "require('fs').writeFileSync(
  'dist/styles.css',
  require('fs').readFileSync('colors_and_type.css','utf8') + '\n' +
  require('fs').readFileSync('src/styles.css','utf8')
)"
```

What gets produced under `dist/`:

| File | Source |
|------|--------|
| `dist/index.js` + `dist/index.d.ts` | from `src/index.tsx` via `tsc` |
| `dist/tokens.js` + `dist/tokens.d.ts` | from `src/tokens.ts` |
| `dist/components.d.ts` | from `src/components.d.ts` (types-only) |
| Per-component `.js` + `.d.ts` files | from `src/components/*.tsx` |
| `dist/internal/cx.js` + `.d.ts` | from `src/internal/cx.ts` |
| Source maps (`.js.map`) and declaration maps (`.d.ts.map`) | enabled in `tsconfig.json` |
| `dist/styles.css` | concatenation of `colors_and_type.css` + `src/styles.css` |

`tsconfig.build.json` (verified, full file):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "emitDeclarationOnly": false,
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts", "**/*.test.tsx", "node_modules", "dist", "preview", "src/styles.css"]
}
```

`package.json:32` declares `"files": ["dist", "src", "README.md"]` — so the published tarball includes the `src/` tree as well as `dist/`. (`.npmignore` exists at the repo root; verify excluded paths if needed.)

`package.json:31` declares `"sideEffects": ["**/*.css"]` so JS modules are tree-shakeable while CSS imports are preserved.

## Release pipeline

Triggered by tag push `v*.*.*` (or manual via Actions UI). Source: `.github/workflows/release.yml`.

Four jobs:

1. **`build` — Build & verify.** `pnpm install`, `pnpm typecheck`, `pnpm build`, then **refuse to continue if `package.json` version != tag** (the workflow does `[ "$TAG" != "v$VERSION" ] && exit 1`). Uploads `dist/`, `package.json`, `README.md` as the `dist` artifact.
2. **`publish-npm`.** Downloads the `dist` artifact, sets up Node with `registry-url: https://registry.npmjs.org` and `scope: @ossrandom`, runs `npm publish --provenance --access public`. Authenticated via `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. Wired to a GitHub `environment: npm` — set up an environment with required reviewer to gate publishes (`.github/SETUP.md` step 3).
3. **`publish-gpr`.** Same package, registry rewritten to `https://npm.pkg.github.com`, auth via auto-provided `GITHUB_TOKEN`.
4. **GitHub Release.** Auto-generated notes + the `.tgz` tarball attached.

### Cutting a release

Source: `.github/RELEASING.md`.

```bash
pnpm version patch    # 0.1.0 → 0.1.1 (or minor / major)
git push --follow-tags
```

`pnpm version` writes the new version into `package.json` and creates the matching tag atomically — that's why the release workflow's tag-vs-version check passes when you use it. **Do not edit `package.json` version by hand**; the workflow will reject the tag.

### Required secrets

Source: `.github/SETUP.md` step 2.

| Secret | Where used | Notes |
|--------|-----------|-------|
| `NPM_TOKEN` | `publish-npm` job | npmjs.com → Granular access token, "Publish for @ossrandom" |
| `GITHUB_TOKEN` | `publish-gpr` job, `GitHub Release` step | Auto-provided by Actions, no setup needed |

## Deploy

Not applicable — this is a published library. The "deploy" surface is the npm + GitHub Packages registries plus the GitHub Release page.

## Gotchas

- **CSS concat, not bundle.** `pnpm build` produces `dist/styles.css` via `Node fs.writeFileSync(... readFileSync('colors_and_type.css') + '\n' + readFileSync('src/styles.css'))`. If you rename, move, or split either input CSS file, **the build silently emits a broken stylesheet**. Update `package.json:37` in the same diff.
- **`tsconfig.build.json` `exclude` lists `src/styles.css`** so TypeScript doesn't try to type-check the CSS file via the broad `include: ["src/**/*"]` glob. Don't remove the exclude when restructuring.
- **CI is currently lenient.** Lint and test steps both use `continue-on-error: true` (`.github/workflows/ci.yml:34, :38`) with `# remove once eslint config lands` / `# remove once tests land` comments. Removing those flags should be coordinated with landing the corresponding config / first test.
- **Tag-version mismatch hard-fails the release.** `release.yml` does an explicit `if [ "$TAG" != "$PKG" ]; then exit 1; fi`. Use `pnpm version <bump>` and `git push --follow-tags`; never edit `package.json` version separately from the tag.
- **`environment: npm` may gate publishes.** If a required reviewer is configured (`.github/SETUP.md` step 3 recommends this), the npm publish step waits for manual approval. Pipeline jobs after `publish-npm` (GitHub Packages, GitHub Release) won't run until approval lands.
- **`environment: github-packages`** likely exists for the `publish-gpr` job — `[inferred]`: not seen in the truncated portion of `release.yml` indexed here. Verify by reading the bottom of `.github/workflows/release.yml` if you need to set up reviewers there too.
- **Branch is ahead of `origin/main` by 1 unpushed commit** (`git status`, verified). The unpushed commit is `b0ea3b1 checkpoint: pre-yolo`. CI on `origin/main` reflects the prior `b5f630a` state until the checkpoint is pushed.
- **`pnpm preview` is a placeholder.** It does not start a server — it just `echo`s a hint. Open the HTML files directly in a browser.
- **No Storybook, no test runner output, no visual diff.** Once you build, verify components by hand in `preview/`. There is no automated UI gate.
