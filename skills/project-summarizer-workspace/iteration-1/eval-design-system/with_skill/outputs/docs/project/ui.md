# UI

This is itself a UI library, not a UI app — the document below describes the *internal* architecture of the components, so an agent making "UI improvements" knows where to land changes.

## Stack

- **Framework:** React 18 (peer dependency, `package.json:48-50`). Functional components only; uses `forwardRef` (`src/components/buttons.tsx:11`) and `React.useEffect` / `useMemo` / `useState`. No class components observed.
- **Build tool:** `tsc` (TypeScript 5.6) — no Vite/Rollup/esbuild. Output is plain ESM `.js` + `.d.ts` + sourcemaps.
- **Styling:** Vanilla CSS using CSS custom properties (CSS variables). All component selectors are class-based (`.rcs-*`) with BEM-ish modifier suffixes (`--variant`, `--size`). No CSS-in-JS, no Tailwind, no PostCSS pipeline. Tokens defined in `colors_and_type.css`; component styles in `src/styles.css`.
- **State management:** Local React state per component. One global side-effect singleton: the `toast` store in `src/components/feedback.tsx:226-263` (plain `Array` + `Set<Listener>`).
- **Routing:** N/A (library has no routing).
- **Data fetching:** N/A.

## Entry & layout

- **Public entry:** `src/index.tsx` — re-exports every runtime component and every type. ~25 lines, easy to scan.
- **Token sub-path entry:** `src/tokens.ts` — exposed via `package.json:exports` as `@ossrandom/design-system/tokens`.
- **Stylesheet entry:** `dist/styles.css` (built artifact = `colors_and_type.css` + `src/styles.css` concatenated, see `package.json:36`). Consumers import `@ossrandom/design-system/styles.css`.
- **Provider stack:** Only one provider exists — `ThemeProvider` (`src/components/theme.tsx`). It is *not* required for components to render (each reads CSS variables directly), but it is the supported way to switch light/dark, override `--accent`, or swap fonts.

## Component organization

- **One file per component family** under `src/components/`. Each file exports 1–8 components grouped by domain (e.g. `feedback.tsx` holds Alert, Modal, Drawer, Progress, Skeleton, Spin, Tooltip, toast, ToastRegion). Listing in `src/index.tsx`.
- **Naming:** files are kebab-case (`form-controls.tsx`, `data-display.tsx`); component identifiers are PascalCase (`Button`, `IconButton`).
- **Single types file:** `src/components.d.ts` holds *every* prop interface (`ButtonProps`, `InputProps`, `TableProps<T>`, `ToastApi`, ...) — this is unusual; conventional layouts colocate types per component. Don't split this file unless the user asks.
- **Internal-only utilities:** `src/internal/cx.ts` — `cx(...parts)` className composer (filters falsy, joins with space), `uid(prefix)` monotonically incrementing id generator, `noop()`. Components import from `../internal/cx`.
- **Naming for CSS:** root class = `rcs-<component>`; sub-elements = `rcs-<component>-<part>` (`rcs-card-body`, `rcs-modal-title`); modifiers = `rcs-<component>--<modifier>` (`rcs-button--primary`, `rcs-alert--danger`). Verified by grepping `src/styles.css` (`.rcs-alert`, `.rcs-alert--danger`, `.rcs-alert-icon`, etc.).

## Design system

This *is* the design system. Surfaces:

| Surface | File | What it defines |
|---------|------|-----------------|
| CSS variables | `colors_and_type.css` | All tokens — colors (`--bg-0`, `--fg-1`, `--accent`, `--accent-hover`, `--accent-soft`), spacing (`--space-1..N`), radii (`--radius-sm/md/lg/full`), shadows (`--shadow-*`), motion (`--dur-fast`, `--ease-out-quart`), typography (`--font-sans`, `--font-mono`, `--fs-*`, `--lh-*`, `--ls-*`, `--fw-*`) |
| TS token unions | `src/tokens.ts` | Compile-time-checked token names: `BrandColor`, `SemanticColor`, `ThemeMode`, `SpaceSize`, `Radius`, `Shadow`, `FontFamily`, `FontWeight`, `TypeScale`, `Size`, `Density`, `Direction`, `Axis`, `Align`, `Justify` |
| Theme runtime | `src/components/theme.tsx` | `ThemeProvider` flips `data-theme="light\|dark"` on `<html>`; can override `--accent` via the `BRAND_HEX` map (`theme.tsx:13`) |
| Visual gallery | `preview/*.html` (39 files) | Standalone HTML cards, one per token group / component family. Manual eyeball reference. Each links `../colors_and_type.css` directly. Entry: `preview/responsive-check.html` |
| Reference layouts | `ui_kits/marketing/`, `ui_kits/app/`, `ui_kits/docs/` | JSX components composed against tokens. **Not shipped to npm.** Loaded via Babel-standalone in their `index.html` — for prototyping/inspection only |

## Theming model

- `data-theme="light"` and `data-theme="dark"` selectors in `colors_and_type.css` redefine the variable values. Components are token-pure, so theme swap is a single attribute write. Confirmed in `src/components/theme.tsx:32-34`.
- **Accent override:** `ThemeProvider` accepts an `accent: BrandColor`. It writes the corresponding hex (from `BRAND_HEX`, `theme.tsx:13-24`) into `document.documentElement.style.setProperty("--accent", ...)`. Note: only `--accent` is overridden — derivatives like `--accent-hover` are not recomputed `[inferred]` from this code path.
- **Font override:** `fontFamily.{sans,mono}` writes `--font-sans` / `--font-mono` inline.
- **Outside provider:** `useTheme()` falls back to `window.matchMedia("(prefers-color-scheme: dark)")` and returns no-op setters (`theme.tsx:65-72`). Calling `setMode`/`toggle` without a provider silently does nothing.

## Accessibility

Patterns observed in `src/components/buttons.tsx` and `feedback.tsx`:

- `Button` sets `aria-disabled` and `aria-busy` for loading states (`buttons.tsx:42-43`).
- `IconButton` requires `"aria-label": string` (`components.d.ts` — required field, not optional).
- `Modal` uses `role="dialog" aria-modal="true"` and links `aria-labelledby` to the title id (`feedback.tsx:53-56`).
- `Alert` uses `role="alert"`.
- `ToastRegion` uses `aria-live="polite" aria-atomic="false"` (`feedback.tsx:272`).
- Backdrop click-to-close gated on `e.target === e.currentTarget` to avoid swallowing inner clicks (`feedback.tsx:58`).
- `Esc`-to-close in `Modal` via a `useEsc(active, handler)` hook (`feedback.tsx:34-46`).

No automated a11y tooling is wired up `[inferred]` — no axe, no eslint-jsx-a11y in deps.

## Reduced motion / contrast

Not directly verified in this survey. The token `--ease-out-quart` and `--dur-fast` appear in `src/styles.css:24-29`, but `prefers-reduced-motion` overrides were not searched for `[inferred]`. Worth a grep before touching motion: `grep -r "prefers-reduced-motion" colors_and_type.css src/styles.css`.

## Patterns to copy when adding a component

1. **Define props in `src/components.d.ts`.** Extend `BaseProps`. Mark arrays `readonly`. Pin event signatures (`(value: V, e: ChangeEvent<HTMLInputElement>) => void`).
2. **Implement in `src/components/<file>.tsx`.** Use `forwardRef` if it wraps a single DOM element you'd want a ref to (see `Button`). Compose classNames with `cx(...)`.
3. **Style in `src/styles.css`** under `/* ============================================================ <NAME> ============================================================ */` comment header (matches existing convention). Use tokens, not literals.
4. **Re-export from `src/index.tsx`** — one line, runtime + types implicit (types are wildcard-exported).
5. **Add a preview card** in `preview/components-<family>.html` if you want eyeball verification.
6. **No tests required currently** (none exist), but Vitest is wired if you choose to add them.

## Performance notes

- Zero runtime deps; bundle size comes only from your component code + (peer) React.
- `Stat` includes an inline SVG `Sparkline` (`src/components/data-display.tsx`) — pure render, no canvas.
- `Avatar` accepts `size` as either union (`xs|sm|md|lg`) or raw `number` (`data-display.tsx`, AVATAR_SIZE map). Same pattern in `Radius` and `SpaceSize` token unions.
- `toast.show` uses `window.setTimeout(..., dur)` with no cleanup tracking on the entry — if a consumer dismisses early via `toast.dismiss(id)`, the timeout still fires (no-op since the entry is gone). Minor — flag if you change this code.
