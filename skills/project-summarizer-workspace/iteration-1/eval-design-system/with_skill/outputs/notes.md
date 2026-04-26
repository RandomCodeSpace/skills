# notes.md

## 1. Deep-dives written and why

- **`docs/project/ui.md`** — This is itself a UI library. The user explicitly wants to onboard another agent for "UI improvements", so the internal UI architecture (components, tokens, theming, conventions for styling) is the highest-value deep-dive.
- **`docs/project/conventions.md`** — There are enough subtle conventions (single types file, `cx()` usage, `.rcs-*` BEM, no path aliases, strict `readonly`) that they couldn't fit in `PROJECT_SUMMARY.md`'s top-level list without crowding it. A future agent making changes will read this first.
- **`docs/project/build-and-run.md`** — Build is non-trivial: two-step (tsc + CSS concatenation), tag/version verification gate, dual-registry publish, and several gotchas (quoted Node one-liner, no dev server, `continue-on-error` flags). The release pipeline alone justifies a dedicated doc.

## 2. Deep-dives skipped and why

- **`architecture.md`** — Skipped. The architecture is one-layer: `src/components/*.tsx` → `src/styles.css` + token CSS → bundler. There's no service boundary, no layering, no event flow. Anything I'd write would either repeat the directory map in `PROJECT_SUMMARY.md` or pad with prose.
- **`data-model.md`** — Skipped. No database, no ORM, no schema files, no domain entities. The closest thing to "data" is the token type unions in `src/tokens.ts`, which are already documented in `ui.md`.
- **`flows.md`** — Skipped. No user/system journeys to trace. A library has function calls, not flows. I considered "trace `toast.show()` → `ToastRegion` render" as a candidate flow, but it's 6 lines of code already cited in `PROJECT_SUMMARY.md` Gotchas / `ui.md`. A flow doc would be padding.
- **`integrations.md`** — Skipped. Zero external integrations at runtime (zero runtime deps). The CDN imports in `colors_and_type.css` (Google Fonts) and `ui_kits/*/index.html` (unpkg) are already flagged as gotchas in `PROJECT_SUMMARY.md` and `build-and-run.md`. The publish targets (npm, GitHub Packages) are covered in `build-and-run.md`. Splitting them into a third file would dilute, not clarify.

## 3. Inferred vs verified — items I'd want to verify later

Marked `[inferred]` in the docs:

- **No ESLint config committed** — inferred from the absence of `eslint.config.js` / `.eslintrc*` in my `ls` output and the CI's `continue-on-error` comment. Worth a `find -name 'eslint*'` to be 100% sure.
- **`assets/fonts/Inter-Regular.woff2` etc. presence** — `colors_and_type.css` references them via `@font-face` `src: url("assets/fonts/Inter-Regular.woff2")`, but I did not list `assets/fonts/`. If the fonts aren't there, air-gapped consumers fall back to Google Fonts via the `@import`.
- **`components.d.ts` ~700 LOC** — I read `wc -l` output but didn't pull the exact number into context; cited as `[inferred]`. A precise count would replace the rough figure.
- **No `.nvmrc` / `.tool-versions` / `mise.toml`** — based on the root `ls`, but not exhaustively confirmed.
- **`release.yml` 4th job** — the file was truncated in my batch (`(2)` chunk cut off at `publish-gpr:`). The README enumerates a "GitHub Release" 4th step; I cited that as `[inferred]` from README rather than the workflow file directly.
- **Theme accent override doesn't recompute derivative variables** (`--accent-hover`, `--accent-soft`) — based on reading `theme.tsx:35-39` which only writes `--accent`. I didn't trace the CSS to confirm whether these derivatives are defined as functions of `--accent` or as standalone tokens.
- **`.tsx` extensions for files that may not need JSX** — convention statement; not exhaustively checked.
- **Test file colocation convention** — there are no tests; I guessed colocated since `tsconfig.build.json` excludes `**/*.test.ts*` patterns (suggesting they'd live alongside source).
- **`SemanticColor` self-questioning comment** — the code comment in `src/tokens.ts:21` is real; my interpretation that "the semantic palette is not fully settled" is a soft inference from that comment plus the lack of green/yellow tokens.

## 4. Skill friction

- **Step 1 ambiguity for libraries.** The skill's table has no row that says "this is a UI library / design system". I used `ui.md` for the internals (since the user said "UI improvements") but the by-project-type guide for **Library** says "skip / shrink: deployment, infra. Libraries rarely have those." — yet this library has a non-trivial release pipeline that genuinely warranted `build-and-run.md`. The existing types ("CLI tool", "Library", "Web app", "Web service", "Mobile", "Monorepo", "Infra", "Data pipeline") don't have a clean fit for "design-system / component library". I picked Library + treated `ui.md` as describing the library's UI domain — worked, but I had to interpret.
- **`docs/project/ui.md` is described as "Has a frontend"** in the SKILL.md table. A component library *is* a frontend dependency, but the template's questions ("Routing — file-based vs. config-based") don't apply. I had to skip multiple template sections (routing, data fetching, forms-as-major-surface) and stretch others (state management → "the toast singleton"). A note in the skill saying "for component libraries, repurpose `ui.md` to document the library's internal UI architecture" would help.
- **"Single types file" was unusual.** No skill guidance on how to flag a non-standard pattern that the next agent should respect rather than refactor. I leaned on `conventions.md` "Things to avoid" — but a more explicit hint in the skill ("call out non-standard organizational choices the next agent might 'fix' against the user's wishes") would be useful.
- **`continue-on-error` on lint/test in CI** — high-value gotcha but felt like it needed to live in three places (top-level Gotchas, conventions, build-and-run). I duplicated. Skill could note: "important gotchas may legitimately be repeated in deep-dives — don't be afraid of one-line cross-references."
- **`SKILL.md` (in the target repo)** — this is a Claude-skill manifest for the project's *consumers*, not for the project itself. I almost mistook it for a meta-document about this repo's structure. The skill being summarized had a `SKILL.md` of its own that was a red herring. Worth a heads-up in the skill: "manifests like `SKILL.md`, `AGENTS.md`, `CLAUDE.md` may exist as content the project ships, not as docs about the project."

## 5. Approximate time spent

- **Survey (steps 2–3):** two `ctx_batch_execute` calls covering ~50 commands and ~150 KB of indexed source. Maybe 30 seconds of model time, but token-cheap because raw file contents stayed in the sandbox and I queried them via FTS5.
- **Writing (step 5):** four files. The bulk of the cost.
- **"Sample don't read everything" worked very well here.** Reading `src/index.tsx` (25 lines), `tokens.ts` (60 lines), `internal/cx.ts` (20 lines), `theme.tsx` head (~70 lines), `buttons.tsx` head (~80 lines), `feedback.tsx`'s toast section (~50 lines), and grepping `.rcs-*` classes was enough to derive every convention claim. I never needed `inputs.tsx`, `selects.tsx`, `form-controls.tsx`, `chat.tsx`, `code.tsx`, `page.tsx`, `navigation.tsx`, `badges.tsx`, `layout.tsx`, or 95% of `components.d.ts`. The fanned-out preview HTMLs and `ui_kits/*` JSX I treated as listing-only — confirmed they exist, didn't read internals.
- **What would have blown the budget:** reading every component source. There are 15 component files plus 3 JSX kits plus 39 preview HTMLs — easily >5k lines. The skill's "sample for signals" guidance was the right call.
