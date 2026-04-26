---
name: project-summarizer
description: Use whenever the user wants to summarize, document, or onboard onto an existing project they've cloned — phrases like "summarize this project", "help me understand this codebase", "I just cloned X and need to grok it", "document this repo for AI agents", "generate project context", "produce an AGENTS.md / PROJECT_SUMMARY.md", or any request to produce structured project documentation an AI agent can later use to modify, extend, or improve the code. Make sure to use this skill whenever the user mentions wanting an overview, walkthrough, summary, or onboarding doc for an existing repository, even if they don't explicitly say "summary" — including phrases like "what does this project do", "explain this codebase", "ramp me up on this repo". Produces a tiered `PROJECT_SUMMARY.md` at the repo root plus targeted deep-dive files under `docs/project/`, with every claim grounded in real file paths so the next agent can trust and verify it.
---

# Project Summarizer

This skill produces a tiered project summary aimed at **AI agents who will later modify or improve the codebase**. The output is dense, structured, and grounded in real file paths — not marketing prose, not a tutorial.

The audience is the next agent who lands in this repo with zero context. That agent needs to:

1. Understand what the project is and how it's organized
2. Run, build, and test it without trial-and-error
3. Modify it without breaking conventions
4. Know what's verified vs. inferred so it doesn't propagate hallucinations

Optimize relentlessly for that reader. Every claim should be checkable against a file or command. Speculation is worse than silence.

## What you produce

**Always:** `PROJECT_SUMMARY.md` at the repo root — the single entry-point document.

**Only when warranted:** deep-dive files under `docs/project/`. Don't create a file if there's nothing meaningful to put in it; empty/skeletal files are noise that costs the next agent context budget for no payoff.

| File | Create when | Skip when |
|------|-------------|-----------|
| `docs/project/architecture.md` | Multi-component system, non-trivial layering, or anything beyond a single binary/script | Single-file or single-package project where the dir map already conveys the structure |
| `docs/project/data-model.md` | Database, ORM, schema files, or domain entities worth tracing | No persistent state, or only flat config files |
| `docs/project/ui.md` | Frontend app **or** the project is itself a UI library / design system | No UI surface at all (CLI, backend lib with no UI concerns) |
| `docs/project/flows.md` | 1+ key user/system journeys that cross multiple files | Single dispatch path; library with function calls but no flows |
| `docs/project/conventions.md` | Conventions overflow PROJECT_SUMMARY's top-level list, **or** there's an "Adding a new X" recipe worth its own section | 3–5 simple rules that fit comfortably in PROJECT_SUMMARY.md |
| `docs/project/integrations.md` | Calls external APIs, queues, message brokers, third-party services | Project only `os/exec`s local binaries / no runtime external dependencies |
| `docs/project/build-and-run.md` | Build is non-trivial: multi-step, build tags, codegen, embed paths, multiple targets | Single command (`go build`, `npm run build`, `cargo build`) with no surprises |

The top-level `PROJECT_SUMMARY.md` always lists the deep-dives that exist (and only those), so the next agent knows where to look next without guessing.

## Workflow

### Step 1 — Confirm scope (briefly)

Ask only what you don't already know:

- If `PROJECT_SUMMARY.md`, `AGENTS.md`, `CLAUDE.md`, or `docs/project/` already exist, ask whether to **overwrite, refresh, or append**. Don't silently clobber existing context.
- If the user has explicit emphasis or omissions ("ignore the legacy `v1/` folder", "I only care about the API"), capture that.

If the user gave enough context already, skip the question and start working.

### Step 2 — Survey the repo (breadth before depth)

Read in this order; stop reading once you have what you need. **Do not read every source file** — sample.

1. **Root docs** — `README*`, `ARCHITECTURE*`, `CONTRIBUTING*`, `CHANGELOG*`, any other root `*.md`. The README usually answers half your questions.
2. **Manifest / dependency files** — pick the ones that exist:
   - JS/TS: `package.json`, `tsconfig*.json`, lockfiles
   - Python: `pyproject.toml`, `setup.py`, `requirements*.txt`, `Pipfile`, `poetry.lock`
   - Go: `go.mod`, `go.sum`
   - Rust: `Cargo.toml`, `Cargo.lock`
   - JVM: `pom.xml`, `build.gradle*`, `settings.gradle*`
   - Ruby: `Gemfile`, `Gemfile.lock`
   - C/C++: `CMakeLists.txt`, `Makefile`, `meson.build`
   - .NET: `*.csproj`, `*.sln`, `Directory.Build.props`
   - Mobile: `pubspec.yaml` (Flutter), `*.xcodeproj`, `app/build.gradle` (Android)
3. **CI / deploy** — `Makefile`, `.github/workflows/`, `.gitlab-ci.yml`, `Dockerfile*`, `docker-compose*.yml`, `Procfile`, `helm/`, `k8s/`, `terraform/`, `serverless.yml`. CI files are the **best source of truth for build/test commands** because they actually run.
4. **Top-level directory map** — `ls` the root and one or two levels into the main source folders. You need the shape, not every leaf.
5. **Entry points** — `main.*`, `cmd/*/main.go`, `src/index.*`, `app.py`, `manage.py`, `server.*`, framework-specific entrypoints, `[bin]` in `Cargo.toml`, `"bin"` in `package.json`.
6. **Schemas** — migration files, ORM models, `schema.sql`, OpenAPI/GraphQL/protobuf definitions.
7. **Existing docs** — `docs/`, `ADR/`, `RFC/`, in-repo design specs (e.g. `docs/superpowers/`, `docs/v02/`). Link from the relevant deep-dive — don't restate their content. These often answer "why" questions you'd otherwise speculate about.

Use `Glob` and `Read` (or `ctx_batch_execute` for multi-command surveys) — favor parallel commands for speed. **Use a subagent (`Explore` / general-purpose) when the survey would otherwise dump >5k lines into your context.**

### Step 3 — Sample source code for *signals*, not coverage

Open a thin, representative slice:

- The main entry point and 1–2 things it directly imports
- 1–2 files from each major top-level package / module
- 1–2 test files (one unit, one integration if present) — tests reveal expected interfaces and the testing style
- Error / exception handling, if it lives in a centralized place
- Config loading

You're hunting for: **error-handling pattern, dependency injection style, layering, where business logic lives vs. where I/O happens, naming conventions, testing style.** A 2-line glance at five files tells you more than a deep read of one.

### Step 4 — Decide which deep-dives to write

Apply the table above. **When in doubt, write fewer.** A single-file CLI script needs only `PROJECT_SUMMARY.md`. A microservice with DB + React frontend likely warrants `architecture.md`, `data-model.md`, `ui.md`, `conventions.md`, `build-and-run.md`.

Empty or skeletal deep-dives are an anti-pattern: they cost the next agent a tool call and return nothing. If you can't fill a deep-dive with concrete, file-grounded content, fold the one or two useful sentences into `PROJECT_SUMMARY.md` instead.

### Step 5 — Write the docs

Use the top-level template below. For deep-dives, read `references/deep-dive-templates.md` on demand — only when you've decided to write that specific file. (If the project warrants 4+ deep-dives, just load the file once — the per-template loading discipline is for small projects, not for ones that need most of the templates.)

Apply these rules across **every** file you produce:

- **Cite paths.** Every concrete claim should reference a file (`src/auth/jwt.ts`) or directory. Where line-level matters, use `file.ext:42`.
- **Quote the actual command.** Don't write "run the tests" — write the exact command from `package.json` / `Makefile` / CI. If you didn't verify it works, say so explicitly.
- **Three verification states.** (1) *Verified*: read directly — claim freely. (2) *Sampled*: read part of a large file — cite the read range, e.g. "sampled `server.go:1–200`". (3) *Inferred*: not directly verified — tag `[inferred]`. Reserve `[inferred]` for the third case. *Absence* claims (no CI, no tests, no release automation) are verified by a listing command — note the command, don't tag `[inferred]`.
- **No marketing.** "A blazing-fast, modern foo" — cut. "A Rust HTTP server using axum 0.7, single binary, ~30k LOC" — keep.
- **Concrete over abstract.** "Uses repository pattern" alone is weak. "Repository pattern: each domain entity has a `*Repository` struct in `internal/<entity>/repo.go` exposing `Find/Save/Delete` that take a `context.Context`" is useful.
- **Don't paste what's cheap to re-read.** Don't dump `package.json` into the doc — point to it. Do capture *non-obvious* things that aren't easy to find via grep (gotchas, implicit conventions, env quirks).
- **Be honest about what you didn't read.** A gap acknowledged is far better than a fabricated section.
- **Distinguish "docs about this project" from "content this project ships".** A repo that is itself a Claude skill, plugin, or template will contain a `SKILL.md`, `AGENTS.md`, or similar — that's *content for the project's consumers*, not metadata about the project itself. Check the file's frontmatter / shape and treat it as content unless it clearly describes the repo. The same applies to `examples/`, `templates/`, and demo apps.
- **High-value gotchas may legitimately appear in multiple places.** A build-tag requirement (e.g. `-tags sqlite_fts5`) belongs in PROJECT_SUMMARY's Gotchas, in `build-and-run.md`'s Gotchas, and possibly in `conventions.md`'s "Things to avoid". Don't fear one-line cross-references when the cost of missing the rule is high — surface it where the relevant agent will look.
- **Surface "don't refactor" rules.** If the project makes a non-standard organizational choice on purpose (single types file, hand-rolled dispatcher, flat package layout), call it out so the next agent doesn't "fix" it. Canonical home: `conventions.md` "Don't refactor" section, or PROJECT_SUMMARY "Things to avoid" if there's no full conventions file.

### Step 6 — Verify before declaring done

- Skim `PROJECT_SUMMARY.md` end-to-end as if you were a fresh agent. Could you actually start working from this?
- Every command listed: confirm it appears in the source you claim it came from. (Exception: for very large hand-rolled route tables / dispatcher files, exhaustive verification isn't practical — sample a few and mark the unread surface `[inferred]`.)
- Every deep-dive linked from `PROJECT_SUMMARY.md`: confirm the file exists and has substance.
- Gotchas have a home. Canonical homes are: PROJECT_SUMMARY's `Gotchas`, `conventions.md`'s "Things to avoid" / "Don't refactor", and `build-and-run.md`'s `Gotchas`. If a gotcha doesn't fit any of those, surface it in your hand-off message rather than burying it in unrelated prose.
- Tell the user what you wrote, what you intentionally skipped (and why), and any uncategorized findings.

## Top-level template — `PROJECT_SUMMARY.md`

````markdown
# Project Summary: <name>

> Generated by `project-summarizer` on <YYYY-MM-DD>. Audience: AI agents (and humans) who need to understand and modify this codebase. Every claim should be checkable; items marked `[inferred]` were not directly verified.

## Identity

- **What it is:** <1–2 sentence description of purpose, in plain language>
- **Type:** <CLI tool | library | web service | web app | mobile app | desktop app | monorepo | infra | data pipeline | other>
- **Status:** one of `active` (recent non-checkpoint commits), `maintained` (sporadic but real activity), `archived`, or `pre-release / freshly bootstrapped` (0–1 commits, or only "checkpoint" commits — don't guess maturity from this). Cite the signal you used (e.g. "5 commits in last 7 days" or "no commits since 2024").
- **Primary language(s):** <e.g. Go 1.22, TypeScript 5.4>

## Tech stack

- **Frameworks / key libs:** <top 3–7 with versions, sourced from the manifest>
- **Datastore(s):** <if any, with version>
- **Build system:** <make, npm scripts, gradle, cargo, bazel, etc.>
- **Test framework(s):** <jest, pytest, go test, junit, etc.>
- **Manifest files read:** `<list>`

## Entry points

| Entrypoint | File | Purpose |
|------------|------|---------|
| ... | `path/to/file` | one-liner |

## Directory map

```
<repo>/
├── <dir>/   — purpose (1 line)
├── <dir>/
│   ├── <subdir>/   — purpose
│   └── <subdir>/
└── ...
```

Only include directories worth knowing. Skip `node_modules/`, `.git/`, `target/`, `dist/`, vendor caches, generated files.

## Run, build, test

Commands taken from `<source — e.g. Makefile / package.json scripts / .github/workflows/ci.yml>`:

```bash
# install deps
<cmd>

# run locally
<cmd>

# run tests
<cmd>

# build / package
<cmd>
```

**Required env / external services:** <list each with where it's read in code, e.g. `DATABASE_URL` — read in `internal/config/config.go:31`>. If none, say "none".

## Conventions an agent must respect

The top 3–7 rules for safely modifying this code. One line each, with a file reference. Full set (if needed) lives in `docs/project/conventions.md`.

- ...

## Gotchas

Non-obvious things that bite. Anything an agent reading the code linearly would miss: monkey-patches, env-dependent behavior, build steps that need a special flag, tests that hit a real network, undocumented invariants.

- ...

## Where to look next

(Only list deep-dives that actually exist.)

- Architecture & components → `docs/project/architecture.md`
- Data model → `docs/project/data-model.md`
- UI → `docs/project/ui.md`
- Key flows → `docs/project/flows.md`
- Conventions (full) → `docs/project/conventions.md`
- External integrations → `docs/project/integrations.md`
- Build & deploy details → `docs/project/build-and-run.md`
````

## Deep-dive templates

When you've decided to write a deep-dive, read `references/deep-dive-templates.md` for the structure of that specific file. Each template is a few hundred words; don't load them all upfront.

## Heuristics by project type

Different project types want different emphasis. Quick guide (full detail in `references/by-project-type.md`):

- **CLI tool** — commands/subcommands, flag parsing, exit codes, where business logic separates from CLI plumbing
- **Library** — public API surface, semver discipline, what's intentionally NOT exposed, example usage
- **Web service / API** — routes, middleware chain, auth model, request lifecycle, error envelope
- **Web app (frontend)** — routing, state management, component hierarchy, build pipeline, env-driven config
- **Monorepo** — package boundaries, dependency graph, what's shared vs. duplicated
- **Infra (Terraform / Helm)** — module structure, what's manual vs. automated, **blast radius warnings on destructive changes**
- **Data pipeline** — sources, sinks, schedule, idempotency story, failure / replay model

When unsure, lean toward the **service / app** template — it has the broadest coverage.

## When this skill should step back

- The user is asking about a single function or file — that's normal codebase exploration, not summarization. Use `Read` / `Grep` directly.
- The repo has a recently updated `PROJECT_SUMMARY.md` / `AGENTS.md` / `CLAUDE.md` and the user only wants to refresh one section — do that targeted edit, don't regenerate everything.
- The user wants to *generate* a new project from scratch — that's scaffolding, a different task entirely.
- The user wants a human-facing README — different audience, different writing style; keep marketing-prose patterns out of this skill.
