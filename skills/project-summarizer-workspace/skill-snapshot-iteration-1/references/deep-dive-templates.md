# Deep-dive Templates

Read this file only when you've decided to write a specific deep-dive. Each template targets one file under `docs/project/`. Apply the same rules from `SKILL.md`: cite paths, mark `[inferred]` claims, no marketing prose.

## `docs/project/architecture.md`

Write this when the project has multiple components, non-trivial layering, or any non-obvious structural choices.

```markdown
# Architecture

## High-level shape

<2–4 sentences. What kind of system is this — request/response, event-driven, batch pipeline, library, plugin host? What are the major moving parts? An ASCII box diagram is welcome but optional.>

## Components

For each major component (service, package, layer, process):

### <Component name>

- **Lives in:** `path/to/component/`
- **Responsibility:** <one sentence>
- **Key files:** `<file>` — <what it does>
- **Talks to:** <other component(s) via HTTP / direct call / queue / DB>
- **Owns:** <state, tables, files, etc.>

## Layering / dependency rules

If the codebase has explicit layering (e.g. handler → service → repository, or hexagonal/clean architecture), state the rule:

- `<layer A>` may import `<layer B>` but not the reverse, enforced by `<lint rule / convention>`
- ...

## Cross-cutting concerns

- **Logging:** <library, where it's configured, log level convention>
- **Error handling:** <pattern — exceptions, Result types, error envelope>
- **Auth / authz:** <where it's enforced, what's exempt>
- **Observability:** <metrics, tracing, what's instrumented>
- **Config:** <where it's loaded, precedence — env > file > defaults?>

## Why it's shaped this way

If you can find rationale (ADRs, README, commit messages, PRs) for non-obvious choices, capture it briefly. If not, skip — don't speculate.
```

## `docs/project/data-model.md`

Write this when there's a database, ORM models, schema files, protobuf types, or domain entities worth tracing.

```markdown
# Data Model

## Storage

- **Primary datastore:** <e.g. Postgres 15, defined in `docker-compose.yml:db`>
- **Secondary stores:** <Redis, S3, etc., and what they hold>
- **Migration tool:** <flyway, alembic, sqlx, prisma, etc., with file path>

## Entities

For each significant entity / table / type:

### <Entity>

- **Defined in:** `<file>`
- **Backing table:** `<table_name>`
- **Key fields:** `<field>: <type>` — <meaning if non-obvious>
- **Relations:** <FK references / has_many / belongs_to>
- **Invariants:** <constraints not visible in schema — e.g. "status transitions are append-only">

## Relationships overview

A short list or diagram of the most-traversed joins / references. Skip if there are only 2–3 entities.

## Lifecycle / state machines

If any entity has a state field with meaningful transitions, document them:

`pending → processing → (succeeded | failed) → archived`

Cite the file enforcing the transitions.

## Schema source of truth

Make it unambiguous which file defines the schema (the migration vs. the ORM model vs. the SQL dump). The next agent will mess this up if you don't.
```

## `docs/project/ui.md`

Write this when there's a frontend (web, mobile, desktop GUI).

```markdown
# UI

## Stack

- **Framework:** <React 18, Vue 3, SvelteKit, Flutter, SwiftUI, etc., with version>
- **Build tool:** <Vite, Next.js, Webpack, etc.>
- **Styling:** <Tailwind, CSS Modules, styled-components, design tokens>
- **State management:** <Redux, Zustand, Pinia, Riverpod, etc., or "local component state only">
- **Routing:** <library and where routes are defined>
- **Data fetching:** <react-query, SWR, RTK Query, raw fetch, etc.>

## Entry & layout

- **Entry file:** `<path>`
- **Root layout / shell:** `<path>`
- **Provider stack:** <theme, query client, auth, i18n — order matters>

## Component organization

How are components organized? Examples of conventions to capture:

- Feature folders vs. type folders (`features/<feature>/` vs. `components/`, `hooks/`, `pages/`)
- Naming convention for files (`PascalCase.tsx` vs. `kebab-case.tsx`)
- Where shared/UI primitives live vs. feature-specific components
- Story files (`*.stories.tsx`), test colocation (`*.test.tsx`)

## Design system

If there's a token system, component library, or strict style guide, point at it:

- Tokens: `<file>`
- Primitives: `<dir>`
- Documented in: <Storybook URL, internal docs>

## Forms & validation

If forms are a major surface, name the library (react-hook-form, formik, vee-validate) and the validation approach (zod, yup, custom).

## i18n / a11y / theming

- i18n: <library, where strings live>
- a11y: <any explicit standards, lint rules>
- Theming / dark mode: <how it's wired>

## Performance notes

Anything an agent should know before touching the UI: virtualization on long lists, image optimization, code-splitting boundaries, hydration gotchas (SSR/SSG), bundle-size budgets.
```

## `docs/project/flows.md`

Write this when there are 1+ key user/system journeys worth tracing through code. **Pick the 2–4 most important flows** — don't try to document every endpoint.

```markdown
# Key Flows

## Flow: <name, e.g. "User signup">

**Trigger:** <HTTP request / CLI invocation / cron / queue message — be exact>

**Path through code:**

1. `<entrypoint file:line>` — <what happens>
2. `<next file:line>` — <next step>
3. `<...>` — <...>
4. `<terminal file:line>` — <result, side effects>

**Side effects:** <DB writes, queue messages, emails, logs, metrics>

**Failure modes:** <what can go wrong, where it's caught>

---

## Flow: <name>

(repeat structure)
```

The shape (numbered call chain with file:line refs) is the value. Keep prose minimal.

## `docs/project/conventions.md`

Write this when there are enough conventions worth documenting that the top-level "Conventions" section can't hold them. Otherwise, fold the top 3–7 into `PROJECT_SUMMARY.md` and skip this file.

```markdown
# Conventions

Rules to follow when modifying this code. Each item: the rule, an example file showing it, and the *why* if it's non-obvious.

## Code style

- <rule> — see `<file>` — <why, if not just "team style">

## Error handling

- <pattern, e.g. "Errors bubble as `Result<T, AppError>`; never `panic!` outside `main`"> — see `<file>`
- <how new error variants are added>

## Naming

- <file naming, function naming, test file location>
- <package / module naming if there's a system>

## Tests

- <where tests live: colocated vs. separate `tests/` dir>
- <unit vs. integration split>
- <fixtures / factories convention>
- <how to run a single test>

## Logging

- <which logger, at what level, what fields are required>
- <any PII redaction rules>

## Adding a new <thing>

If there's a recurring "to add a new X, touch files A, B, C" pattern (e.g. adding a route, a CLI command, a domain entity), document the recipe. This is high-value for an agent.

Example:

> **Adding a new HTTP route:**
> 1. Define handler in `internal/api/<resource>/handler.go`
> 2. Wire in `internal/api/router.go:registerRoutes`
> 3. Add request/response types in `internal/api/<resource>/types.go`
> 4. Add integration test in `internal/api/<resource>/handler_test.go`

## Things to avoid

Patterns that *look* idiomatic but aren't, given this codebase's history. Example: "Don't introduce new dependencies on `<deprecated package>` — it's being removed; use `<replacement>`."
```

## `docs/project/integrations.md`

Write this when the project calls external APIs, queues, message brokers, or third-party services.

```markdown
# External Integrations

For each external dependency the running system talks to:

## <Service name>

- **Purpose:** <what we use it for>
- **Client lives in:** `<file>`
- **Auth:** <env var name, secret manager path>
- **Endpoints / topics used:** <list>
- **Failure mode:** <retry, circuit breaker, fallback, fail-loud>
- **Cost / quota notes:** <if relevant — e.g. "rate-limited to 100 req/s", "billed per token">
- **Local-dev story:** <stub, mock, real with sandbox creds, docker-compose service>
```

## `docs/project/build-and-run.md`

Write this when the build is non-trivial — multi-step, env-dependent, multiple targets, or has gotchas a one-line command can't capture.

```markdown
# Build & Run

## Prerequisites

- <runtime: Go 1.22 / Node 20 / Python 3.12 / etc. — exact versions if pinned in `.tool-versions` / `.nvmrc` / `mise.toml`>
- <system packages: e.g. `libpq-dev`, `protoc`, `openssl`>
- <docker, if needed>

## First-time setup

```bash
<step 1>
<step 2>
...
```

Cite the source for each step (Makefile target, README, CI).

## Local development loop

How does the user iterate? Hot reload? Watch mode? Multi-process (api + worker + frontend)?

## Test layers

- **Unit:** <command, where they live, how fast>
- **Integration:** <command, what infra they need, how they're isolated>
- **E2E:** <command, browser/runner, how they're invoked>

## Build artifacts

- **What gets produced:** <binary, container image, npm package, Docker image, etc.>
- **Where:** <output paths>
- **How to release:** <tag-driven, manual, GitHub Actions workflow>

## Deploy

- **Targets:** <prod env, staging, ephemeral>
- **Method:** <Helm chart, GitOps with ArgoCD, Terraform apply, CI deploy job>
- **Rollback:** <how, and what state survives a rollback>

## Gotchas

Build-time things that bite: native deps, codegen steps, env vars required even for `make build`, platform-specific quirks.
```
