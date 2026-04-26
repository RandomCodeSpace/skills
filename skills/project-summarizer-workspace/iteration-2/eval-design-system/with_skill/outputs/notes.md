# Notes — project-summarizer v2 eval on `~/projects/design-system`

## 1. Deep-dives written and why

Per the new "Component library / design system" archetype in `references/by-project-type.md` (lines 51–69), this archetype "typically warrants `ui.md` and `build-and-run.md`. It rarely warrants `architecture.md`, `data-model.md`, `flows.md`, or `integrations.md`."

I wrote four deep-dives:

- **`docs/project/architecture.md`** — borderline call. The skill's by-project-type guidance for component libraries says architecture rarely warrants its own file. But the repo has multiple intentional structural choices (single-types file, family-grouped components, no bundler, only-one-internal-util) that benefit from a short structural doc that an agent can read once. I kept it lean and pointed at component organization rather than a request/response architecture.
- **`docs/project/ui.md`** — required by archetype. Used the new "Library mode" branch in `references/deep-dive-templates.md` (skip Routing/Data-fetching/Forms-as-major-surface; expand Component organization, Design system, Bundling & publish). The template's Library-mode bottom section was directly applicable.
- **`docs/project/conventions.md`** — required because the rules overflow `PROJECT_SUMMARY`'s top-level Conventions section (>7 rules, plus an "Adding a new component / new token" recipe, plus a Don't-refactor section that's load-bearing here).
- **`docs/project/build-and-run.md`** — required by archetype guidance. The dual-registry publish + tag/version-sync gate + in-build CSS-concat one-liner are non-trivial enough to warrant a dedicated file.

## 2. Deep-dives skipped and why

Following the "Skip when" column of the SKILL.md table, plus the by-project-type guidance:

- **`data-model.md`** — skipped. No persistent state, no DB, no schema, no domain entities. The closest thing to a "model" is the prop interfaces in `src/components.d.ts`, which are covered in `architecture.md` and `ui.md`.
- **`flows.md`** — skipped. A library has no flows in the user/system-journey sense — there's no entrypoint that crosses files in sequence. Component lifecycles are React-internal and not interesting to trace.
- **`integrations.md`** — skipped. Zero runtime deps, zero external API calls. The only "external" surface is the unpkg CDN that `ui_kits/*/index.html` use, which is reference material, not the product. Captured as a Gotcha + a one-liner in `build-and-run.md` and `conventions.md`.

## 3. Inferred vs verified

I marked positive inferences with `[inferred]` and used verification commands for absence claims, per the SKILL.md rules.

**Verified by reading the file directly:**
- All component exports in `src/index.tsx`
- Token unions in `src/tokens.ts`
- ThemeProvider behaviour (`src/components/theme.tsx`)
- Toast / Modal implementations (`src/components/feedback.tsx`)
- Build script string (`package.json:scripts.build`)
- Release workflow stages (`.github/workflows/release.yml`)
- CI workflow stages and `continue-on-error` flags (`.github/workflows/ci.yml`)
- README's "Project layout" / "Editing components" / "Releases" sections
- `tsconfig.json` and `tsconfig.build.json`
- `data-theme="light|dark"` wiring in `colors_and_type.css` (lines 153, 201, 240)
- 39 `preview/*.html` cards (listed)
- `ui_kits/` reference layouts and their unpkg-CDN dependencies (`ui_kits/marketing/index.html`)
- Only 2 git commits in the repo's history (`git log --oneline`)

**Absence claims (verified by command output, not `[inferred]`):**
- "No tests exist" — verified via `find /home/dev/projects/design-system -name '*.test.*' -o -name '*.spec.*'` returning nothing.
- "No eslint config" — verified via `ls .eslintrc* eslint.config.*` returning "No such file or directory".
- "No vitest config" — verified via `ls vitest* vite*` returning "No such file or directory".
- "No Storybook" — verified via `ls .storybook` returning "No such file or directory".
- "No bundler" — verified via grepping `devDependencies` (no Vite/Rollup/Webpack present).
- "`prefers-reduced-motion` not honored" — verified via grep across `colors_and_type.css` and `src/styles.css`.

**Marked `[inferred]`:**
- "Components don't import across families" — convention asserted but not exhaustively grepped on every file; flagged inline in `architecture.md` and `conventions.md`.
- The rationale behind single-types-file and `.rcs-*` naming — no ADR / commit message exists explaining the choice; called this out in `architecture.md > Why it's shaped this way`.
- The `publish-gpr` job's GitHub Actions environment name.
- `Table<T>` lacking virtualization — confirmed by absence of virtualization libs in `package.json` but not by reading the full Table source.
- `package.json:exports` routing — confirmed via the exports map but not by tracing every consumer permutation.
- `screenshots/` directory contents — listed but not opened.

## 4. Skill friction (v2)

**What worked well:**

- The new "Component library / design system" archetype (`by-project-type.md:51`) is well-targeted. Its explicit guidance — `ui.md` + `build-and-run.md`, rarely architecture/data-model/flows/integrations — saved decision time. The "Skip the standard `ui.md` 'Routing' / 'Data fetching' / 'Forms-as-major-surface' sections" line is exactly the right framing for libraries.
- The "Library mode" branch in `deep-dive-templates.md > docs/project/ui.md` (line 95-97 and the Bundling & publish section at line 148-156) matched the project shape precisely. Tag/version-sync gates, dual-registry publishes, and CSS-distribution model are all called out — the file basically wrote a checklist for me.
- The skill's warning at `SKILL.md:103` ("Distinguish 'docs about this project' from 'content this project ships'") was directly relevant: this repo has a `SKILL.md` at the root that targets *consumers of the design system*, not contributors. The warning saved a probable mistake — I would otherwise have treated it as authoritative for build/test/structure.
- The "Don't refactor" section guidance (`SKILL.md:105`, plus `by-project-type.md:184`) was high-value here: this codebase makes several deliberate non-standard choices (single types file, family-grouped components, hand-authored CSS) that an agent could very plausibly "fix". The conventions file's "Don't refactor" section now flags all of them.
- Absence-claims-need-verification rule (`SKILL.md:98`) made me run actual `ls` / `find` checks rather than asserting "no tests" inferentially.

**Where v2 still felt rough:**

- **Architecture.md ambiguity for library-mode projects.** The by-project-type table says component libraries "rarely warrant" architecture.md. Mine had non-trivial layering choices worth documenting (single types file, internal/cx, family grouping). The skill could be more explicit: "for component libraries, write a short architecture.md ONLY if there are non-standard organizational choices worth pinning; otherwise fold into PROJECT_SUMMARY". The current "rarely" leaves the call to the agent.
- **`screenshots/` directory** had no obvious treatment. It's clearly a developer artefact not intended for runtime. The skill's "What to skip" guidance covers `node_modules/`, `dist/`, `target/`, etc., but not project-specific developer scratch dirs. I noted it as `[inferred]` but never opened it; that's defensible but slightly unsatisfying.
- **`ui_kits/` is a unique case** — neither pure docs nor part of the published product. They're React reference layouts loaded with Babel-via-CDN. The skill's "examples/templates/demo apps" warning (line 103) covers the spirit, but a more concrete bullet on "reference apps that ship in the repo but aren't part of the build" would help.
- **Tag/version-sync gate gotcha** is a perfect example of the skill's high-value-gotcha-may-appear-in-multiple-places rule (line 104). It legitimately belongs in PROJECT_SUMMARY's Gotchas, in `build-and-run.md`'s Gotchas, and is referenced in `ui.md`'s Bundling-and-publish section. The cross-reference cost is low and the cost of missing the rule is "publish failure on first release", so the duplication is justified.
- **The "Library mode" template's section list is good but not exhaustive.** It says skip Routing/Data-fetching/Forms; expand Component-organization/Design-system/Bundling-and-publish. It does NOT mention "Library-specific gaps to surface" (test gaps, a11y gaps, motion-prefs gaps). I added that section ad-hoc to `ui.md` because the skill's `library` section in `by-project-type.md:64` flags weak test coverage as a thing to surface explicitly. Could be promoted into the template.
- **Verification before completion (`SKILL.md > Step 6`)** says "skim PROJECT_SUMMARY.md end-to-end as if you were a fresh agent". I did this in my head but it's the kind of step the skill could explicitly recommend running through subagent eyes — for outputs > ~400 lines of markdown, a quick sanity-check pass would catch dead links and hand-waving.

## 5. Approximate time spent

~22 minutes of agent wall-clock time, dominated by two `ctx_batch_execute` rounds (one structural survey, one targeted file reads) plus the writing of five files. No re-reads, no false starts. The pre-existing README in this repo is unusually good and saved easily 5–10 minutes of inference work.
