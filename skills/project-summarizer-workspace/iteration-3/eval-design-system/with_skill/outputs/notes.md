# Notes — iteration 3, eval-design-system / with_skill

## 1. Deep-dives written / skipped

- `docs/project/ui.md` — **written**. Library-mode template; Known gaps section was high-leverage.
- `docs/project/build-and-run.md` — **written**. Concat-CSS dance, version-tag gate, soft-fail CI all need explicit framing.
- `docs/project/architecture.md` — **skipped**. Single-package library with one internal helper (`cx.ts`) and 13 sibling component files. The directory map in PROJECT_SUMMARY conveys the structure.
- `docs/project/data-model.md` — **skipped**. No persistent state.
- `docs/project/flows.md` — **skipped**. No multi-file user/system journeys; component prop → handler → rendered DOM is local to each file.
- `docs/project/conventions.md` — **skipped**. 7 conventions fit cleanly in PROJECT_SUMMARY; "Don't refactor" coverage is in PROJECT_SUMMARY's Conventions and Gotchas + ui.md's Known gaps.
- `docs/project/integrations.md` — **skipped**. No runtime external services (npm + GitHub Packages are publish targets, covered in build-and-run.md).

## 2. Verification breakdown

Approximate count across PROJECT_SUMMARY + ui.md + build-and-run.md:

- **Verified** (read directly): ~50 claims. Component lists from `index.tsx`, token unions from `tokens.ts`, `cx.ts` contents, the build script, `tsconfig.build.json`, `package.json` fields, CI workflow steps, the "Editing components" README block, the `BRAND_HEX` constant, line counts, the 251 `.rcs-*` class count, the 70 type exports in `components.d.ts`, the 38 preview HTML cards, exported components per file via `grep`.
- **Sampled** (read part of a large file, range cited): ~3 claims. `components.d.ts` head + tail (file is 648 lines; only first ~30 + interface-list grep + last ~30 read). `feedback.tsx` head only. `_card.css` header comment only.
- **`[inferred]`** (not directly verified): ~5 claims, all flagged.
  1. React 19 untested in CI (no test suite, so technically a sub-claim of verified absence).
  2. `Markdown / RichTextEditor / Terminal / CodeBlock` fidelity vs `react-markdown` — didn't read `src/components/code.tsx`.
  3. `environment: github-packages` gating in `release.yml` — bottom of file truncated in the indexed snapshot.
  4. Type-checking under React 19 may surface new errors — speculative.
  5. The `BRAND_HEX` ↔ `colors_and_type.css` drift risk is "currently the only guard" — verified there's no JS side; didn't grep for a CI check.
- **Absence claims marked with verification commands** (not `[inferred]`): no test files (`find . -name '*.test.*'`), no ESLint config (`find . -maxdepth 2 -name '.eslintrc*'`), no Storybook (`find . -maxdepth 2 -name '.storybook'`), no CHANGELOG (`find . -maxdepth 2 -name 'CHANGELOG*'`).

V3 rule applied correctly: absence claims have commands, not `[inferred]` tags.

## 3. Skill v3 friction

**The new status heuristic helped.** With 2 commits (one `Initial Commit`, one `checkpoint: pre-yolo`), v2 would have tempted me to write `active` because the timestamps are recent. The explicit "0–1 commits or only checkpoint commits → `pre-release / freshly bootstrapped`" rule is unambiguous and short. Wrote `pre-release / freshly bootstrapped` with confidence and cited the signal.

**Verification states helped, but the most useful sub-rule was the absence-claim one.** The instinct to slap `[inferred]` on "no tests" / "no ESLint config" was strong; the rule explicitly redirected that to a `find` command. Good guardrail. The Verified / Sampled distinction was less load-bearing here — most of the project's source files are small enough to read whole.

**Library-mode Known gaps was the highest-leverage v3 addition for this project.** Without it I would have folded the test-coverage / ESLint-config / Storybook-absence facts into Gotchas, and the next agent would discover them via failing assumptions. Having a dedicated section meant the gaps surface as gaps, not as quirks. The "an agent making UI improvements needs to know what's *already* broken" framing is exactly the right framing — used it almost verbatim.

**In-repo planning docs — link, don't restate.** Applied to `.github/SETUP.md`, `.github/RELEASING.md`, `.github/PUSH.md`, `README.md` Releases section. Cited their paths from `build-and-run.md` and PROJECT_SUMMARY rather than re-pasting their checklists. Saved space, kept the source of truth in one place. There were no `docs/superpowers/`-style design specs in this repo, so the rule didn't get its hardest test here.

**Where the skill is still rough:**

- **`SKILL.md` ambiguity inside a design-system repo.** The skill mentions content-vs-metadata in passing, but a repo whose `SKILL.md` is *itself a Claude skill the package consumers invoke* is a very specific shape. I caught it because the frontmatter said `name: randomcodespace-design`, but a less careful agent would treat it as the project's own AGENTS.md analogue. Worth a one-line example in the skill.
- **The "no bundler" path isn't called out.** `by-project-type.md` § Component library mentions ESM/CJS dual builds, peer-dep models, dual-registry publishes — all good. But the *plain-`tsc`-no-bundler* path (with the manual CSS concat in `package.json` scripts) is unusual enough that it deserves a one-liner in the heuristics.
- **Library mode says "skip Routing / Data fetching / Forms"** but doesn't say much about **state-management surfaces a library *might* expose** (like the in-memory `toast` queue here). I made it a sub-bullet under Stack; arguably it deserves its own line in the template.
- **No guidance on when to surface uncommitted work.** The "branch ahead of origin by 1 commit" + checkpoint-style commit is a real shape (it's why the status heuristic exists), but the skill doesn't say "mention it explicitly in Gotchas". I did it on instinct.

Friction overall is low. v3 is a clear improvement — the heuristics it added are the ones I would have wanted v2 to have.

## 4. Token cost vs. v2

**Roughly equivalent or slightly less.** The wins and costs:

- **Less:** The status heuristic short-circuited a paragraph I would have otherwise written justifying why "active" or "early" was wrong. Linking `.github/SETUP.md` instead of restating its checklist saved ~20 lines in build-and-run.md. The `find ...` commands for absence claims are 1-line gotchas instead of multi-sentence "could not verify" hedges.
- **More:** Known gaps in ui.md is 8 bullets I would not have written under v2 — they would have been distributed across Gotchas / Things to avoid in PROJECT_SUMMARY, but compressed. Total chars probably went up slightly because I separated them, but each one is more findable.

Net: probably +5% chars, -10% redundancy. Good trade.
