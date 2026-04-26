# UI

This is **library mode** — the project ships UI components for other apps to depend on. Sections about Routing / Data fetching / Forms-as-major-surface are intentionally omitted (they describe an app, not a library).

## Stack

- **Framework:** React 18+ (peer dep — `package.json:46–49`).
- **Build tool:** plain `tsc` to JS + `.d.ts`. No bundler. CSS produced by a Node `fs` one-liner concatenating `colors_and_type.css` + `src/styles.css` — see `package.json:37`.
- **Styling:** hand-rolled BEM with the `.rcs-*` prefix. 251 unique classes in `src/styles.css` (verify: `grep -oE '\.rcs-[a-z0-9-]+' src/styles.css | sort -u | wc -l`). No CSS-in-JS, no CSS Modules, no Tailwind, no PostCSS.
- **State management:** local React state per component (`useState` / `useEffect`). The `toast` API is the one shared store — an in-memory queue rendered by `<ToastRegion />` (`src/components/feedback.tsx:230` and `:265`).

## Entry & layout

- **Public entry:** `src/index.tsx` (35 lines). Pure re-export module — `export type * from "./tokens"`, `export type * from "./components"`, then named runtime re-exports per component file.
- **No app shell.** This is a library; consumers wrap their own tree in `<ThemeProvider>` and optionally render `<ToastRegion />` once near the root (`README.md` § "Mounting the toast region").
- **Provider stack consumers should use:** `<ThemeProvider mode="light|dark" accent? fontFamily?>` is the only provider exported. There is no `QueryClientProvider`, `I18nProvider`, etc. — none shipped, none required.

## Component organization

**Components are grouped by "card" of related primitives, not one-component-per-file.** Verified via `ls src/components/`:

| File | Components |
|------|-----------|
| `buttons.tsx` | `Button`, `IconButton`, `ButtonGroup` |
| `inputs.tsx` | `Input`, `NumberInput`, `PinInput`, `Textarea` |
| `selects.tsx` | `Select<V>`, `Combobox<V>` |
| `form-controls.tsx` | `Checkbox`, `RadioGroup<V>`, `Switch`, `Slider`, `DatePicker`, `DateRangePicker`, `FileUpload`, `FormField` |
| `badges.tsx` | `Badge`, `StatusDot` |
| `layout.tsx` | `Card`, `Space`, `ScrollDiv`, `Divider`, `Grid` (+ `Grid.Col`) |
| `navigation.tsx` | `Tabs<K>`, `Menu<K>`, `Breadcrumb`, `Pagination`, `Steps` |
| `feedback.tsx` | `Alert`, `Modal`, `Drawer`, `Progress`, `Skeleton`, `Spin`, `Tooltip`, `toast`, `ToastRegion` |
| `data-display.tsx` | `Table<T>`, `Stat`, `Avatar`, `Timeline` |
| `chat.tsx` | `Chat` |
| `code.tsx` | `CodeBlock`, `Markdown`, `Terminal`, `RichTextEditor` |
| `page.tsx` | `PageHeader`, `AppShell` |
| `theme.tsx` | `ThemeProvider`, `useTheme` |

Each component file exports both `forwardRef`-wrapped functional components (e.g. `Button` in `buttons.tsx:10`) and plain functions (`PageHeader`, `AppShell`, etc.). The repo mixes the two depending on whether ref-forwarding is required for the underlying element.

**Single internal helper:** `src/internal/cx.ts` (verified — 23 lines). Exports `cx()` (truthy-string class joiner), `noop()`, and `uid(prefix = "rcs")`. Components import `cx` from here; this is the only internal-shared module.

## Design system

- **Token *types*:** `src/tokens.ts` (57 lines, verified). Exports `BrandColor`, `SemanticColor`, `ThemeMode`, `SpaceSize`, `Radius`, `Shadow`, `FontFamily`, `FontWeight`, `TypeScale`, `Size`, `Density`, `Direction`, `Axis`, `Align`, `Justify`. All as discriminated string unions; some accept `number` as an escape hatch (`SpaceSize`, `Radius`).
- **Token *values*:** `colors_and_type.css` at the repo root. CSS variables (`--bg-0`, `--accent`, `--font-sans`, etc.). The build concatenates this file *first* into `dist/styles.css`, so token definitions sit above component class rules — consumers get one stylesheet.
- **Theming:** `<ThemeProvider mode>` writes `data-theme="light|dark"` on `document.documentElement` (`src/components/theme.tsx:30–34`). The CSS variables in `colors_and_type.css` are scoped under `[data-theme="…"]` selectors, so swapping the attribute swaps the palette. Optional `accent={BrandColor}` writes `--accent` inline on `documentElement`; optional `fontFamily` overrides `--font-sans` / `--font-mono` similarly.
- **`BRAND_HEX` constant** (`src/components/theme.tsx:18–28`): the only place where `BrandColor` token names are mapped to hex values *in JS*. Keep this in sync with `colors_and_type.css` — there is no automated check.
- **Documented in:** `README.md`, plus 38 standalone HTML demo cards in `preview/` (one per component group, plus `colors-*`, `spacing-*`, `type-*`, `brand-*` reference cards). The `preview/responsive-check.html` viewer renders any card inside an iframe at preset device dimensions (iPhone 15, iPad mini, Galaxy S24, etc. — see `preview/_card.css` header comment for the full list).

## i18n / a11y / theming

- **i18n:** none shipped. No string-table abstraction; components accept user-provided text as props.
- **a11y:** components apply ARIA where applicable — verified on `Button` (`aria-disabled`, `aria-busy`, `aria-hidden` on the spinner span, `src/components/buttons.tsx:42–46`). No project-wide a11y lint rule (no ESLint config — see "Known gaps").
- **Theming:** see "Design system" above.

## Performance notes

- **Side effects:** `package.json:31` declares `"sideEffects": ["**/*.css"]` — this means tree-shakers will retain CSS imports but drop unused JS modules. Consumers who do `import { Button } from "@ossrandom/design-system"` will only get `Button`'s JS, but **the entire `dist/styles.css` ships with one `import "@ossrandom/design-system/styles.css"`** — there is no per-component CSS extraction.
- **No lazy-loading boundaries** in the library. Components render synchronously; consumers can wrap heavy ones (`RichTextEditor`, `Chat`) in their own `React.lazy` if needed.
- **`Markdown`, `RichTextEditor`, `CodeBlock`, `Terminal`** are declared in `src/components/code.tsx`. They have no third-party deps (zero-runtime-dep policy). Behaviour for syntax highlighting / markdown parsing is implemented in-tree — `[inferred]`: their fidelity is likely simpler than e.g. `react-markdown` or `prism-react-renderer`. Read `src/components/code.tsx` before promising downstream consumers full Markdown / Prism parity.

## Bundling & publish

- **Output formats:** ESM only. `package.json:23–25` sets `"type": "module"`, `"main"` and `"module"` both point at `./dist/index.js`. No CJS build.
- **Subpath exports** (`package.json:27–34`):
  - `.` → `./dist/index.js` + `./dist/index.d.ts`
  - `./tokens` → `./dist/tokens.js` + `./dist/tokens.d.ts`
  - `./styles.css` → `./dist/styles.css`
  No deeper sub-imports advertised; tree-shaking individual components depends on the bundler's static analysis.
- **Peer-dep model:** `react: ">=18"`, `react-dom: ">=18"` (`package.json:46–49`). Open-ended upper bound — works with React 19 in theory, **untested in CI** (`[inferred]`: no test suite to verify).
- **CSS distribution:** single concatenated sheet at `dist/styles.css`. Consumers must `import "@ossrandom/design-system/styles.css"` once; there is no per-component CSS file. Token CSS variables come first (concatenated from `colors_and_type.css`), then component classes.
- **Demo / preview surface:** 38 static HTML cards in `preview/` + `responsive-check.html` device-frame viewer. **No Storybook** (verified absent: `find . -maxdepth 2 -name '.storybook'`). The `preview/` cards are static HTML using the *CSS* — they do not import or render the React components.
- **Publish targets and tag/version-sync gate:**
  1. **npm public registry** — `npm publish --provenance --access public`, scoped `@ossrandom`, requires `NPM_TOKEN` repo secret (`.github/SETUP.md` step 2).
  2. **GitHub Packages mirror** — same package, registry rewritten to `https://npm.pkg.github.com`, auth via auto-provided `GITHUB_TOKEN`.
  3. **GitHub Release** — auto-generated notes + `.tgz` tarball attached.
  - Pipeline gate: `release.yml` build job reads `package.json` version and exits non-zero if `${GITHUB_REF_NAME}` != `v$VERSION`. `pnpm version <bump>` writes both atomically — use it.

## Known gaps

This library is freshly bootstrapped; an agent making "UI improvements" should know what's already missing before touching anything. Otherwise pre-existing breakage gets attributed to the change.

- **Zero automated tests.** No `*.test.*` / `*.spec.*` files anywhere (`find . -name '*.test.*' -not -path '*/node_modules/*'` returns nothing). Vitest is declared but unused. CI runs `pnpm run test` with `continue-on-error: true` (`.github/workflows/ci.yml:38`). All component changes must be QA'd manually via `preview/`. **Visual regressions are silent.**
- **No ESLint config checked in.** `pnpm lint` is wired and CI calls it, but no `.eslintrc*` / `eslint.config.*` file exists. CI marks the lint step `continue-on-error: true` (`.github/workflows/ci.yml:34`) with the comment `# remove once eslint config lands`. There is no enforced code-style or a11y lint today.
- **No Storybook.** Visual surface is the 38 HTML cards in `preview/` + the iframe viewer. Cards are **static** — they don't import the React components, they just exercise the CSS. So preview parity is *not* a test of component behaviour, only of styles.
- **Markdown / RichTextEditor / Terminal / CodeBlock are in-tree implementations with zero deps.** The README states "Zero runtime deps". Downstream consumers expecting `react-markdown`-style fidelity will be surprised. `[inferred]` — confirm by reading `src/components/code.tsx`.
- **Peer-dep version skew vs. ecosystem.** `react: ">=18"` admits React 19. No CI matrix runs against React 19. If consumers report React 19 breakage, it won't be caught here.
- **No CHANGELOG.** No `CHANGELOG.md` / release notes file in the repo (`find . -maxdepth 2 -name 'CHANGELOG*'` returns nothing). Consumers tracking breaking changes have only auto-generated GitHub Release notes from tag pushes.
- **Single types file (`src/components.d.ts`, 648 lines, 70 exported types) is intentional**, not a gap — but expect every prop-shape change to land in one diff. Mentioned here so an agent doesn't try to "split for cleanliness".
- **`BRAND_HEX` map in `src/components/theme.tsx:18–28` duplicates colour values that also live in `colors_and_type.css`.** No automated check ensures they match. Drift is possible — a manual eyeball is currently the only guard.
- **`react`/`react-dom` types use `^18.3.0` in `devDependencies`** while peer dep is `>=18`. Type-checking against React 19's stricter types is not exercised. `[inferred]`: typecheck under React 19 may surface new errors.
