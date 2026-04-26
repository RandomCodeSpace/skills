# Conventions

Rules for safely modifying this codebase. Each rule cites the file showing it.

## Code style

- **Strict TypeScript.** `tsconfig.json` enables `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `isolatedModules`. Don't loosen these.
- **`readonly` on prop arrays and objects passed in.** Header of `src/components.d.ts:13` calls this out: arrays are immutability hints. Example: `readonly options: readonly SelectOption<V>[]` (`components.d.ts`, `SelectProps`).
- **No `any`.** The `components.d.ts` header asserts: "Strict event signatures — never `(value: any) => void`". Verified by skim — no `: any` in the surveyed component sources except one `as any` cast in `src/components/buttons.tsx:78` for `React.cloneElement`.
- **No barrel `import * as`.** Consumers import named: `import { Button, toast } from "@ossrandom/design-system"`.
- **`*.tsx` for React, `*.ts` for pure types/utilities.** `src/tokens.ts`, `src/internal/cx.ts` are `.ts`; everything in `src/components/` is `.tsx` even if some might not need JSX `[inferred]`.

## CSS conventions

- **Class names: `.rcs-*`.** Hard rule from README and verified throughout `src/styles.css`. New components must follow `rcs-<component>` for the root, `rcs-<component>-<part>` for sub-elements, `rcs-<component>--<modifier>` for variants.
- **Tokens via CSS custom properties.** Use `var(--accent)`, `var(--bg-1)`, `var(--space-2)`, `var(--radius-sm)`, `var(--fw-medium)`. No raw hex except in the `BRAND_HEX` JS map (`src/components/theme.tsx:13`).
- **Sectioned comments in `src/styles.css`** mark each component's block:

  ```
  /* ============================================================
     BUTTONS
     ============================================================ */
  ```

  Match this pattern when adding a new component's styles.

## Component patterns

- **All props extend `BaseProps`** (`components.d.ts`):

  ```ts
  export interface BaseProps {
    readonly id?: string;
    readonly className?: string;
    readonly style?: CSSProperties;
    readonly "data-testid"?: string;
  }
  ```

- **Compose classNames with `cx(...)`** from `src/internal/cx.ts`. Pattern (from `src/components/buttons.tsx:25-31`):

  ```ts
  const cls = cx(
    "rcs-button",
    `rcs-button--${variant}`,
    `rcs-button--${size}`,
    shape !== "rect" && `rcs-button--${shape}`,
    block && "rcs-button--block",
    className,           // user-provided className always last so it can override
  );
  ```

- **Default props inside the function body**, not via `defaultProps` (deprecated). Use destructuring defaults: `const { variant = "secondary", size = "md", ... } = props;` (`buttons.tsx:13-22`).
- **Use `React.forwardRef` for primitive wrappers** that consumers might want refs to: `Button`, `IconButton`. Higher-level composites (Modal, Drawer, Card) don't currently forward refs.
- **Generics for collection components.** `Select<V>`, `Combobox<V>`, `Tabs<K>`, `Menu<K>`, `RadioGroup<V>`, `Table<T>` — all parameterize the value/key type.

## Adding a new component

Step-by-step recipe (recurring pattern in this repo):

1. **Define props in `src/components.d.ts`.** Place under the relevant `═══` banner section. Extend `BaseProps`. Use `readonly`. Pin event signatures.
2. **Add CSS** in `src/styles.css` under a new `/* ====== <NAME> ====== */` block. Use tokens, not literals.
3. **Implement in `src/components/<existing-or-new-file>.tsx`.** Group by family — don't create a new file for one-off small components if they fit an existing family (e.g. add a new badge type to `badges.tsx`).
4. **Re-export from `src/index.tsx`.** One line under the right grouping.
5. **(Optional) Preview card** in `preview/components-<family>.html`.
6. **Run** `pnpm typecheck && pnpm build` to confirm. (Tests are absent; lint may be unconfigured.)

## Theme & tokens

- **Don't hardcode colors / spacing / fonts.** Use the CSS variables in `colors_and_type.css`.
- **Don't import `colors_and_type.css` from `src/`.** It is concatenated into `dist/styles.css` by the build script (`package.json:36`); `src/styles.css` references the variables but does not `@import` the token file.
- **`tsconfig.build.json:12` excludes `src/styles.css` from the TS build** (it is *not* a TS source). Don't add it to the `include` list.
- **Theme switching is a single DOM attribute.** Don't introduce per-component theme contexts; rely on `data-theme` on `<html>`.

## Imports

- **Relative imports inside `src/`.** No path aliases configured (`tsconfig.json` has no `paths`). Examples:
  - From a component: `import { cx } from "../internal/cx";`
  - From a component: `import type { ButtonProps } from "../components";`
- **`import type` for types-only.** Required for `isolatedModules`. Verified — every component file uses `import type { ... } from "../components"`.

## Tests

- **None currently exist.** `find -name '*.test.*'` returns nothing.
- **Vitest is the chosen runner** (`devDependencies` in `package.json:46`). When tests are added, place them as `*.test.ts` / `*.test.tsx` colocated with the source `[inferred — convention not enforced yet]`. `tsconfig.build.json:12` already excludes `**/*.test.ts*` from the published build.
- **CI tolerates failure here.** `.github/workflows/ci.yml:38` has `continue-on-error: true` with the comment `# remove once tests land`. Remove that flag when adding tests.

## Lint

- **No ESLint config committed.** Only the `lint` script in `package.json:33`. ESLint 9 + `@typescript-eslint` 8 are installed.
- **CI tolerates lint failure.** `.github/workflows/ci.yml:34` is `continue-on-error: true` with comment `# remove once eslint config lands`.
- When adding a config: choose flat config (`eslint.config.js`) since ESLint 9 is the installed version.

## Versioning & releases

- **Semver via `pnpm version <patch|minor|major>`.** This bumps `package.json` and creates a `vX.Y.Z` tag in one step.
- **Don't hand-edit `package.json` version.** The release workflow refuses to publish if the git tag and `package.json` version don't match (`.github/workflows/release.yml`, "Verify tag matches package version" step).
- **Tags trigger publish.** Push tags with `git push --follow-tags`. Pipeline publishes to both npm and GitHub Packages.

## Things to avoid

- **No new runtime dependencies** without explicit approval. The package advertises "zero runtime deps" in `README.md`. Adding a dep changes the consumer's bundle.
- **No CSS-in-JS, no Tailwind, no PostCSS.** The styling story is plain CSS + variables. Don't introduce a build pipeline for styling.
- **Don't `@import` from public CDNs in shipped CSS.** `colors_and_type.css:4` already does this for Google Fonts as a fallback; air-gapped consumers self-host. Do not add new `@import` URLs.
- **Don't move types out of `src/components.d.ts`.** It's a single-file convention. Splitting may seem cleaner, but every existing component imports from `"../components"` — refactoring that is out of scope unless the user asks.
- **Don't introduce React 19-only APIs** (e.g., `use`, asset-loading hooks). Peer dep is `react >=18` and `[inferred]` 18.x is the verification target.
- **Don't `@ts-ignore` or `// eslint-disable` to silence errors.** Header comment in `components.d.ts` and the strict tsconfig exist for a reason.
