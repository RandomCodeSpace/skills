# Architecture

## High-level shape

A library — not a service, not an app. The published artifact (`dist/`) is a tree-shakeable ES module containing 49 React components, type declarations, and one concatenated stylesheet. Consumers do `import { Button } from "@ossrandom/design-system"` plus `import "@ossrandom/design-system/styles.css"` once at app root.

There are no servers, no background workers, no message queues, and no external API calls. The repo also ships **non-published** developer surfaces (`preview/`, `ui_kits/`) that exist only as reference material.

```
                    consumer app
                         │ imports
                         ▼
            ┌─────────────────────────┐
            │ dist/index.js (ESM)     │  ← built from src/index.tsx (re-export only)
            │ dist/index.d.ts         │
            │ dist/tokens.{js,d.ts}   │
            │ dist/styles.css         │  ← colors_and_type.css + src/styles.css
            └─────────────────────────┘
                         │
                         ▼
            ┌─────────────────────────┐
            │ src/components/*.tsx    │  one file per component family
            │ uses src/internal/cx.ts │  the only internal util
            │ uses src/components.d.ts│  for prop types
            │ uses src/tokens.ts      │  for token type unions
            └─────────────────────────┘
```

## Components (modules)

Each "component" here is a `src/components/*.tsx` family file. Twelve runtime modules + one types module + one entry module.

### `src/index.tsx` — Public entry

- **Lives in:** `src/index.tsx`
- **Responsibility:** re-export every runtime component and every type. Has no logic.
- **Talks to:** every file under `src/components/` and the two type modules.
- **Owns:** the public package surface — adding a component requires editing this file.

### `src/components.d.ts` — All prop interfaces (types-only)

- **Lives in:** `src/components.d.ts`
- **Responsibility:** declare every component's `*Props` interface in a single file. Imported by component implementations and re-exported via `export type * from "./components"` in `src/index.tsx`.
- **Convention:** every `*Props` extends `BaseProps` (`id`, `className`, `style`, `data-testid`); arrays are `readonly`; events use specific React event types (`MouseEvent<HTMLButtonElement>`, etc.) — NOT `any`.
- **Note:** intentionally NOT colocated with implementations. See `docs/project/conventions.md` "Don't refactor".

### `src/tokens.ts` — Token type unions

- **Lives in:** `src/tokens.ts`
- **Responsibility:** TypeScript string-literal unions (`BrandColor`, `SemanticColor`, `ThemeMode`, `Size`, `SpaceSize`, `Radius`, `Shadow`, `FontFamily`, `FontWeight`, `TypeScale`, `Density`, `Direction`, `Axis`, `Align`, `Justify`).
- **Pure types** — no runtime values. The JS values for these tokens live in `colors_and_type.css` as CSS variables.

### `src/internal/cx.ts` — The ONLY internal util

- **Lives in:** `src/internal/cx.ts`
- **Responsibility:** `cx(...args)` className composer + `uid()` helper. Used by every component file.
- **Why it matters:** the codebase deliberately keeps internals minimal — there is no utility-belt. Don't add new internals here without explicit need.

### `src/components/*.tsx` — Runtime component families

Each file owns a thematic group; component bodies are colocated. Selected highlights:

- `theme.tsx` — `ThemeProvider` stamps `data-theme` attribute on `document.documentElement`; allows accent override via `--accent` CSS var; exposes `useTheme()` hook with a graceful no-op fallback when no provider is present (reads `prefers-color-scheme`).
- `feedback.tsx` — contains the `toast` imperative API + `ToastRegion` host component. Other feedback primitives (Alert, Modal, Drawer, Progress, Skeleton, Spin, Tooltip) live in the same file.
- `layout.tsx` — `Grid` is built as `Object.assign(GridFn, { Col: GridCol })`, so consumers do `<Grid.Col>` (`src/components/layout.tsx`).
- `data-display.tsx` — `Table<T extends object>` is generic over row type; `RadioGroup<V>`, `Select<V>`, `Combobox<V>`, `Tabs<K>`, `Menu<K>` are similarly generic.

## Layering / dependency rules

There is one explicit layer rule, surfaced by directory shape rather than by lint:

- `src/components/*.tsx` may import from `src/internal/*`, `src/components.d.ts`, `src/tokens.ts`. They should not import from each other (verify by grepping `from "../components/"` inside `src/components/`). [inferred — not exhaustively verified]
- `src/index.tsx` is import-only; it must not declare runtime logic.
- `src/internal/*` must not import from `src/components/*` (would be a cycle).

No lint rule enforces these — the convention is maintained by reviewers.

## Cross-cutting concerns

- **Logging:** none. This is a library; logging is the consumer's concern.
- **Error handling:** components return `React.ReactElement` (or `| null` for conditionally-rendered Modal/Drawer). No throws on bad props — TypeScript catches at compile time. Where a prop is genuinely required for accessibility (e.g. `IconButton.aria-label`), it's marked required in `components.d.ts:55`.
- **Auth / authz:** N/A.
- **Observability:** N/A.
- **Config:** consumers pass props; ThemeProvider accepts `mode`, `accent`, `fontFamily` overrides; CSS vars on `:root` / `[data-theme="…"]` are the configuration surface.
- **i18n:** no built-in i18n layer. Strings are passed in via props (`title`, `description`, `aria-label`, etc.). [inferred — confirmed by `components.d.ts` showing string-typed labels with no message-key abstraction]
- **a11y:** components include `role="alert"`, `aria-modal="true"`, `aria-label` requirements. No automated a11y testing in CI today.

## Why it's shaped this way

Rationale where visible:

- **Single types file** — header of `src/components.d.ts` notes "All components extend a base `BaseProps`" and the convention that arrays are `readonly`. The single-file approach keeps the entire public type surface visible in one diff.
- **`.rcs-*` class names** — chosen to give the design system a distinct namespace so consumers' Tailwind/CSS-Modules/etc. don't accidentally collide. No ADR exists to confirm this; rationale `[inferred]` from naming.
- **Zero runtime deps** — `package.json` enforces this; only React/React-DOM as peer. Likely reasoning: keep the published bundle small and avoid version conflicts in consumer apps. No ADR.

If you need authoritative rationale beyond the above, the git history is too short to help (only 2 commits — see `git log --oneline`).
