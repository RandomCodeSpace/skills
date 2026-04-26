# UI

This is **library mode** — the project itself is a UI component library / design system. There is no app surface to route, fetch, or own forms within. Sections that don't apply to libraries are omitted.

## Stack

- **Framework:** React 18+ (peer dep, `package.json:peerDependencies`).
- **Build tool:** TypeScript compiler (`tsc -p tsconfig.build.json`) + a Node one-liner that concatenates two CSS files into `dist/styles.css`. No bundler (Vite/Rollup/Webpack) — TypeScript emits ESM directly.
- **Styling:** Hand-authored CSS in `src/styles.css`, BEM-ish `.rcs-*` class names. Tokens as CSS custom properties in `colors_and_type.css` at the repo root.
- **State management:** local component state only (`React.useState`). One `React.Context` exists: `ThemeContext` in `src/components/theme.tsx`.

## Public component surface

Re-exported from `src/index.tsx`. 49 components, grouped by family. Source of truth for props is `src/components.d.ts`.

| Family | Components | File |
|---|---|---|
| Buttons | `Button`, `IconButton`, `ButtonGroup` | `src/components/buttons.tsx` |
| Inputs | `Input`, `NumberInput`, `PinInput`, `Textarea` | `src/components/inputs.tsx` |
| Selects | `Select<V>`, `Combobox<V>` | `src/components/selects.tsx` |
| Form controls | `Checkbox`, `RadioGroup<V>`, `Switch`, `Slider`, `DatePicker`, `DateRangePicker`, `FileUpload`, `FormField` | `src/components/form-controls.tsx` |
| Badges | `Badge`, `StatusDot` | `src/components/badges.tsx` |
| Layout | `Card`, `Space`, `ScrollDiv`, `Divider`, `Grid` (+ `Grid.Col`) | `src/components/layout.tsx` |
| Navigation | `Tabs<K>`, `Menu<K>`, `Breadcrumb`, `Pagination`, `Steps` | `src/components/navigation.tsx` |
| Feedback | `Alert`, `Modal`, `Drawer`, `Progress`, `Skeleton`, `Spin`, `Tooltip`, `toast`, `ToastRegion` | `src/components/feedback.tsx` |
| Data display | `Table<T>`, `Stat`, `Avatar`, `Timeline` | `src/components/data-display.tsx` |
| Chat | `Chat` | `src/components/chat.tsx` |
| Code | `CodeBlock`, `Markdown`, `Terminal`, `RichTextEditor` | `src/components/code.tsx` |
| Page | `PageHeader`, `AppShell` | `src/components/page.tsx` |
| Theme | `ThemeProvider`, `useTheme` | `src/components/theme.tsx` |

The "49 components" claim in `README.md > What's in the box` lines up with the family list above (verify with `grep -hE 'export (const|function|class) [A-Z]' src/components/*.tsx | wc -l`).

## Component organization

- **One file per family**, not per component (`src/components/feedback.tsx` ships 9 components together). This is intentional and pre-1.0 — do not split.
- **All prop types in one file:** `src/components.d.ts` (~3.6KB × 7 sections). Top-of-file comment lists conventions: every `*Props` extends `BaseProps`; events typed strictly; readonly arrays.
- **No story files, no Storybook.** Verify: `ls .storybook` returns nothing; no `*.stories.*` files. The "preview" surface is `preview/*.html` (39 standalone HTML cards).
- **No test files colocated** — see `docs/project/build-and-run.md` "Test gaps".
- **`forwardRef` is used selectively** — `Button`, `IconButton`, `Input`, `Textarea` use `React.forwardRef`. Most others are plain function components. (Verify: `grep -l 'forwardRef' src/components/*.tsx`.)

## Design system

- **Tokens (CSS variables):** defined in `colors_and_type.css` at the repo root. CSS variable count: see `grep -c '^\s*--' colors_and_type.css`. Variables include `--bg-0`, `--fg-1`, `--accent`, `--font-sans`, `--font-mono`, etc.
- **Token type unions (TypeScript):** `src/tokens.ts` declares `BrandColor`, `SemanticColor`, `ThemeMode`, `SpaceSize`, `Radius`, `Shadow`, `FontFamily`, `FontWeight`, `TypeScale`, `Size`, `Density`, `Direction`, `Axis`, `Align`, `Justify`. These are types-only — runtime values live in CSS.
- **Brand palette (hex):** mapped in `src/components/theme.tsx` `BRAND_HEX` (`signal-red` `#E60000`, `cod-gray` `#1C1C1C`, light/dark variants).
- **Theming model:** `<ThemeProvider mode="dark" />` toggles `data-theme="light|dark"` on `document.documentElement`. CSS variables in `colors_and_type.css` are scoped per theme:
  - `:root, [data-theme="light"]` (line 153)
  - `[data-theme="dark"]` (line 201)
  - `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` (line 240) — system theme fallback
- **Accent override:** `<ThemeProvider accent="signal-red-700" />` sets `--accent` inline on `<html>` from the `BRAND_HEX` map.
- **Font override:** `<ThemeProvider fontFamily={{ sans: "...", mono: "..." }} />` sets `--font-sans` / `--font-mono` inline.
- **Documented in:** the README `Project layout` and `Editing components` sections, plus `colors_and_type.css` itself. No Storybook, no website. The brand voice/visual rulebook is at `SKILL.md` (root) — that doc targets *consumers of the design system*, NOT contributors to this repo.

## i18n / a11y / theming

- **i18n:** no library. All user-facing strings are props (e.g. `Button.children`, `IconButton["aria-label"]`, `Modal.title`).
- **a11y:** components set explicit ARIA — `Modal` uses `role="dialog" aria-modal="true"` and `aria-labelledby` (`src/components/feedback.tsx`); `Alert` uses `role="alert"`; `IconButton` requires `aria-label` at the type level (`src/components.d.ts:55`). No automated a11y test/lint in CI today.
- **Theming / dark mode:** see `Design system` above. Three-way toggle (light / dark / system-via-prefers-color-scheme).
- **`prefers-reduced-motion`:** not honored in CSS — verify by grepping for `prefers-reduced-motion` (no matches found in `colors_and_type.css` or `src/styles.css` based on the search performed). Per the user's `~/.claude/rules/ui.md`, this is a gap worth flagging if an agent is making UI improvements here.

## Performance notes

- **Tree-shaking:** consumers can `import { Button } from "@ossrandom/design-system"` and bundlers should drop unused components, **as long as `package.json:sideEffects` is correct.** Currently `"sideEffects": ["**/*.css"]` (line 36) — flags CSS as side-effectful but JS as side-effect-free. Verify before claiming tree-shaking works in a specific bundler.
- **Single CSS sheet:** consumers pay the cost of all component styles even if they use only some. There is no per-component CSS distribution today. Splitting would be a non-trivial change.
- **No virtualization** in `Table<T>` or `Menu<K>` — the components render all rows/items. For very long lists, consumers must virtualize externally. [inferred — confirmed by absence of virtualization libs in `package.json` and by the small size of the components].
- **`Modal` / `Drawer` return `null` when `open === false`** (`src/components/feedback.tsx`) — they're not portaled, they render in-tree. Consumer must place the component where the desired stacking context exists.

## (Library mode) Bundling & publish

- **Output formats:** ESM only. `package.json`: `"type": "module"`, `"main"` and `"module"` both point to `dist/index.js`, `"types"` to `dist/index.d.ts`. No CJS build, no UMD.
- **Sub-exports:** three entries via `package.json:exports`:
  - `"."` → `dist/index.{js,d.ts}` (everything)
  - `"./tokens"` → `dist/tokens.{js,d.ts}` (token types only)
  - `"./styles.css"` → `dist/styles.css` (the merged stylesheet)
- **Peer-deps:** `react >=18`, `react-dom >=18`. Strict at the major version — React 19 adoption requires explicit version bump.
- **CSS distribution:** single concatenated sheet at `dist/styles.css` (tokens + components). Per-component CSS imports are NOT supported.
- **Published files:** `package.json:files = ["dist", "src", "README.md"]`. `src/` ships in the tarball as a fallback "read the source" surface; `.npmignore` overrides exclude `.github/`, `preview/`, `scrap/`, test files, configs.
- **Tree-shaking story:** sub-imports like `import { Button } from "@ossrandom/design-system/Button"` are NOT supported — only the three exports above. Use the named export from the package root and trust the bundler.
- **Demo / preview surface:**
  - `preview/*.html` — 39 standalone gallery cards rendered without React (just static HTML showing the design tokens / component visual targets). Open `preview/responsive-check.html` in a browser to iframe-test components across devices.
  - `ui_kits/marketing/`, `ui_kits/app/`, `ui_kits/docs/` — full reference layouts in JSX. They load React + React-DOM + Babel + lucide via **unpkg CDN at runtime** (`ui_kits/marketing/index.html:7-10`). They are NOT bundled, NOT tested in CI, and **will not run offline.**
- **Publish targets:** dual-registry — npm public registry AND GitHub Packages, both under `@ossrandom`. See `docs/project/build-and-run.md` for the workflow detail.
- **Tag/version-sync gate:** the release workflow's `Verify tag matches package version` step (`.github/workflows/release.yml`) exits 1 if `git tag` `vX.Y.Z` ≠ `package.json:version`. Use `pnpm version <bump>` which sets both.

## Library-specific gaps to surface

- **No tests, no eslint config, no Storybook, no automated a11y checks.** Manual visual QA via `preview/*.html` is the current verification mechanism. Any agent making UI improvements should plan for adding at least vitest + RTL coverage for new behaviour, and should not assume CI catches regressions.
- **`prefers-reduced-motion` not honored** in CSS. Per `~/.claude/rules/ui.md`, this is a one-liner to add and should be the first improvement on any UI-quality pass.
