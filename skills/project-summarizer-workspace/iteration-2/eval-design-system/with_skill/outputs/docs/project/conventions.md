# Conventions

Rules to follow when modifying this code. Each item: the rule, an example file showing it, and the *why* if it's non-obvious.

## Code style

- **Strict TypeScript** — `tsconfig.json` sets `"strict": true`, `"noImplicitOverride": true`, `"noFallthroughCasesInSwitch": true`, `"isolatedModules": true`. Don't relax these.
- **JSX runtime:** `"jsx": "react-jsx"` (`tsconfig.json`) — no `import React` shim required for JSX; only import React explicitly when you need its API (`import * as React from "react"` is the prevailing form, see `src/components/theme.tsx:6`).
- **Component bodies:** the prevailing form is `export function Foo(props: FooProps): React.ReactElement { ... }`. Use `React.forwardRef<HTMLElement, FooProps>` only when the component needs to forward a DOM ref (current users: `Button`, `IconButton`, `Input`, `Textarea`).
- **`cx(...)` for className composition** — see `src/internal/cx.ts`. Don't introduce `clsx` or `classnames` — the in-house helper is the standard.

## Error handling

- **No throws.** This is a library; mis-typed props are a TypeScript error at compile time. Modal / Drawer return `null` when closed (`src/components/feedback.tsx`). If a prop is required for a11y, mark it required at the type level (e.g. `IconButton["aria-label"]: string` in `src/components.d.ts:55`).
- **Defensive SSR guards:** `if (typeof document === "undefined") return;` — see `src/components/theme.tsx:30`. Use this pattern in any effect that touches `document` / `window`.

## Naming

- **Files:** kebab-case for filenames in `src/components/` (`form-controls.tsx`, `data-display.tsx`).
- **CSS classes:** `.rcs-*` BEM-ish — block (`.rcs-button`), modifier (`.rcs-button--primary`, `.rcs-button--block`), element/slot (`.rcs-modal-header`, `.rcs-modal-body`). See full list in `src/styles.css`.
- **Type unions:** PascalCase singletons (`BrandColor`, `Size`, `ThemeMode`) in `src/tokens.ts`. Always string-literal unions, never plain `string`.
- **Component prop interfaces:** `<ComponentName>Props` in `src/components.d.ts`.

## Tests

- **Where:** there are no tests today. `package.json:scripts.test` is `vitest run`; `vitest` is in `devDependencies`. CI's test step has `continue-on-error: true` (`.github/workflows/ci.yml:40`).
- **Convention if you add one:** vitest, colocate as `*.test.ts` / `*.test.tsx` next to the file under test. The `tsconfig.build.json:exclude` already excludes `**/*.test.ts(x)` from the build, so tests won't ship to `dist/`. The `.npmignore` also excludes them.
- **CI gate:** when adding the first real test, also remove the `continue-on-error: true` line on the test step (and the lint step, once eslint config lands) — otherwise green CI continues to mean nothing.

## Logging

- N/A — this is a presentational library, no logging.

## Adding a new component

The high-leverage recipe (per `README.md > Editing components`):

> 1. Create `src/components/<family>.tsx` (or add to an existing family file).
> 2. Add the `<Component>Props` interface to `src/components.d.ts`. Extend `BaseProps`. Use strict event types (`(e: MouseEvent<HTMLButtonElement>) => void`, never `any`). Use `readonly` on array props.
> 3. Implement using `import * as React from "react"`, `import { cx } from "../internal/cx"`, and types from `../components` and `../tokens`.
> 4. Add `.rcs-<component>` styles to `src/styles.css` (BEM modifiers and slots).
> 5. Add a `export { Component } from "./components/<family>"` line to `src/index.tsx`.
> 6. (Optional) Add a `preview/components-<component>.html` design-gallery card to demo it.

## Adding a new design token

1. Add the CSS custom property to `colors_and_type.css` (likely under `:root, [data-theme="light"]` AND `[data-theme="dark"]`).
2. If it's a discrete-set token (e.g. a new `Size`), add the literal-union member in `src/tokens.ts`.
3. If it's a hex brand color exposed via `ThemeProvider.accent`, add it to the `BRAND_HEX` map in `src/components/theme.tsx`.

## Things to avoid (anti-patterns)

- **Don't add runtime dependencies.** `package.json` has zero `dependencies`. If you genuinely need a runtime dep, surface the trade-off explicitly (bundle size + version conflict risk for consumers) before adding.
- **Don't introduce a new styling system** (Tailwind, styled-components, css-in-js, CSS Modules). Hand-authored CSS with `.rcs-*` is the standard.
- **Don't add a bundler.** The current setup uses `tsc` directly + a tiny CSS-concat step. Adding Vite/Rollup/Webpack creates a new failure surface and changes the published output shape.
- **Don't import across families.** A component in `feedback.tsx` should not `import { Button } from "../components/buttons"` — keep families self-contained. (Reach for shared primitives via `src/internal/` instead — though today only `cx` and `uid` live there.) [inferred convention — verify by `grep '../components/' src/components/`]
- **Don't put runtime values in `src/tokens.ts`.** It's types-only; runtime values are CSS variables.

## Don't refactor (intentional non-standard choices)

These look unusual but are deliberate. Each entry: what it is, why it exists, and where to verify. **Do not "fix" these without explicit maintainer input.**

> **Single `src/components.d.ts` for ALL component prop types** — instead of colocating each `<Component>Props` next to its implementation. The header comment in `components.d.ts` lays out the conventions enforced by this layout (every `Props` extends `BaseProps`, strict events, readonly arrays). Rationale [inferred — no ADR]: keeps the entire public type surface visible in one diff and forces uniform conventions. Do not split.

> **One `src/components/*.tsx` file per family**, not per component — `feedback.tsx` ships 9 components together. Adds friction to grep-by-component but makes it trivial to share local helpers within a family. Do not split into per-component files.

> **CSS in a single hand-authored `src/styles.css`** with `.rcs-*` BEM classes, concatenated with `colors_and_type.css` at build time. The build script in `package.json:scripts.build` is a one-liner Node `-e` doing the concat. Do not migrate to css-in-js, CSS Modules, or per-component CSS.

> **Two CSS files at different roots:** `colors_and_type.css` lives at repo root (NOT inside `src/`); `src/styles.css` lives inside `src/`. The build concatenates them in that order. Rationale [inferred]: the root file is the "drop-in token sheet" that consumers can also use standalone (it's referenced from `ui_kits/*/index.html` and `preview/*.html`). Don't move either.

> **`tsc`, no bundler.** ESM-only output, no Vite/Rollup. Verify: `package.json` has no bundler in `devDependencies`. Don't introduce one.

> **Zero runtime dependencies.** `package.json:dependencies` is absent — only `peerDependencies` and `devDependencies` are listed. This is a hard line.

> **`SKILL.md` at the repo root is content the project ships, not docs about the project.** It targets *consumers of the design system* (brand voice / visual rules they should follow when building with the system). Don't refactor it into a contributor-facing doc and don't conflate its rules with this repo's contributor conventions.

> **`ui_kits/*/index.html` load React via unpkg CDN.** They are reference layouts only, not part of the published package and not exercised in CI. Do not bundle them, do not enforce CI on them, and do not assume they're production code.
