# By Project Type

Quick guide to what to emphasize when summarizing different kinds of projects. Read this when you've identified the project type during Step 2 and want to focus your sampling and documentation effort.

If a project is genuinely hybrid (e.g. monorepo with a CLI + web app + Terraform), pick the dominant flavor for the top-level summary and use deep-dives for the rest.

---

## CLI tool

**Top emphasis:** the user-facing surface (commands, flags, exit codes) and where business logic separates from CLI plumbing.

Capture:
- The argv-parsing approach: a library (`cobra`, `clap`, `argparse`, `commander`, `yargs`) **or** a hand-rolled dispatcher (e.g. a `map[string]Handler` in a flat `package main`). Hand-rolled is a legitimate choice for small tools — note it as intentional, not as something to "fix".
- The list of subcommands / verbs and their entry handlers.
- The convention for error → exit code mapping (e.g. "non-zero on any error; specific codes for `EX_USAGE`, `EX_DATAERR`").
- Where I/O happens vs. where pure logic lives — agents adding a new command need to know the seam.
- Output formats (human / JSON / quiet / streaming) and how they're switched.

### Sub-pattern: filter / wrapper / passthrough CLIs

Some CLIs are thin wrappers around other tools — they exec a child process, reshape its output, and exit with the child's exit code. Examples: a `git` wrapper that summarizes for an LLM, a `go test` reformatter, a `kubectl` filter.

For these, the standard CLI sections still apply, but the *interesting* content is different:

- The "business logic" *is* the **stdout transformation** itself. Document each command's transformation strategy: `passthrough` / `line-cap` / `stream-reshape` / `buffer-then-reformat`. A small table beats prose.
- The conventions worth pinning are usually **zero third-party deps**, **no subpackage explosion**, and **one filter per file**. These tools win by staying tiny — call that out so the next agent doesn't introduce a framework.
- The "Adding a new wrapped command" recipe is the highest-leverage convention to capture (typically: add a file, register in the dispatcher, add a test).
- Common gotcha: failing to forward the child's exit code or stderr verbatim. Note the policy.

Skip / shrink: heavy "architecture diagrams" — usually overkill for a CLI.

---

## Library

**Top emphasis:** public API surface and stability discipline.

Capture:
- The exported / public API (what's in `index.ts` / `lib.rs` / `__init__.py` / package root) and what's intentionally **not** exported.
- Semver discipline — does the project have one? (Look at `CHANGELOG.md`, release notes, breaking-change conventions.)
- Example usage — pull from the README, `examples/`, or doctests.
- The test surface that pins behavior (so an agent knows what's contractually guaranteed vs. incidental).
- Bundling story — how it's published (npm, PyPI, crates.io, Maven Central), and what the published artifact contains.

Skip / shrink: deployment, infra. Libraries rarely have those — **except component libraries**, which often have non-trivial release pipelines (see next section).

---

## Component library / design system

A specialization of "Library" where the public surface is **UI components**. Examples: a React component library, a Web Components package, a SwiftUI / Jetpack Compose library, a Tailwind plugin.

**Top emphasis:** the component surface, the design-token system, the theming model, and the publish pipeline.

Capture:
- Public component list with one-line responsibility for each. Don't enumerate every prop — that's what types files are for.
- **Token system** — where tokens live (CSS variables, JS object, Sass map, Style Dictionary), how consumers override them, what's themable.
- **Class / style naming convention** (`.rcs-*` BEM, CSS Modules, scoped CSS, css-in-js, atomic CSS) and *why* that choice was made if you can find rationale.
- **Type-file organization** — single `types.ts` vs. per-component types. Note when an unusual organization is intentional, so the next agent doesn't "fix" it.
- **Bundling** — ESM / CJS / both, peer-dep model (which React/Vue/Solid versions are supported), CSS distribution (single sheet vs. per-component).
- **Release pipeline** — semver discipline, dual-registry publishes (npm + GitHub Packages, etc.), tag/version-sync gates, who can publish.
- **Demo / preview surface** — Storybook, kit pages, README examples, example apps in `examples/`.
- **Test gaps** — component libraries often have weak test coverage; if that's the case, surface it explicitly so the next agent knows manual visual checks are needed.

A component library typically warrants **`ui.md`** (treating the library's exported components as the "UI" surface) and **`build-and-run.md`** (because publishing a library is genuinely non-trivial — pipelines, version gates, dual registries). It rarely warrants `architecture.md`, `data-model.md`, `flows.md`, or `integrations.md`.

Skip the standard `ui.md` "Routing" / "Data fetching" / "Forms-as-major-surface" sections — those describe an app, not a library.

---

## Web service / API

**Top emphasis:** request lifecycle and the seams an agent will touch most.

Capture:
- HTTP framework, where routes are registered, how they're grouped.
- Middleware chain in order — auth, logging, tracing, rate limiting, CORS, body parsing.
- Auth model (sessions, JWT, mTLS, API keys), where it's enforced, what's exempt.
- Error envelope / response shape, status code conventions.
- The "add a new endpoint" recipe — files to touch, in order. (This belongs in `conventions.md`.)
- Background jobs / queues if present — where they're defined, how they're triggered, retry semantics.

Strong candidate for `architecture.md`, `data-model.md`, `flows.md`, `integrations.md`, `build-and-run.md`.

---

## Web app (frontend)

**Top emphasis:** routing, state, and where data crosses the network.

Capture:
- Framework (React/Vue/Svelte/Solid/etc.), build tool (Vite, Next.js, Remix, etc.), and the rendering model (SPA, SSR, SSG, RSC, ISR).
- Routing — file-based vs. config-based, where it's defined.
- State management — server state (react-query/SWR), client state (Redux/Zustand/Pinia/signals/local).
- API surface — where requests originate, base URL config, auth handling, error/loading conventions.
- Component conventions — feature folders vs. layered, naming, where shared primitives live.
- Styling system — Tailwind config, design tokens, theme provider, dark mode wiring.

Strong candidate for `ui.md`, `flows.md`, `build-and-run.md`.

---

## Mobile app

**Top emphasis:** platform specifics + state/data flow.

Capture:
- Framework (Flutter, React Native, native iOS/Android, Compose Multiplatform, etc.) and toolchain versions.
- Navigation library and structure.
- State management.
- Native integrations / plugins / permissions and where they're requested.
- Build / signing story — debug vs. release, how to run on a simulator vs. device, store-distribution path.

Strong candidate for `ui.md`, `build-and-run.md`.

---

## Monorepo

**Top emphasis:** package boundaries and the dependency graph between them.

Capture:
- Tool: Nx, Turborepo, Lerna, pnpm workspaces, Bazel, Pants, Gradle multi-project, Cargo workspace, Go modules, etc.
- The list of packages and their purpose.
- The dependency graph — what depends on what. Often visible in `package.json` workspaces / `Cargo.toml [workspace]` / `go.work`.
- Cross-package conventions — shared tooling, lint, types, build outputs.
- Affected-build story — does the repo run only-changed tests/builds?

The top-level `PROJECT_SUMMARY.md` should give the agent the per-package overview; per-package details belong in deep-dives or in each package's own README.

---

## Infra (Terraform / Pulumi / Helm / Kustomize)

**Top emphasis:** module structure and **blast radius**.

Capture:
- Tool and version, backend/state location.
- Module structure — root modules vs. shared modules, where each environment's config lives.
- What's managed by IaC vs. clicked-in manually (this is almost always partial; an honest "these resources exist but aren't managed here" list is gold).
- Environments and how they're separated (workspaces, dirs, tfvars).
- Apply pipeline — manual `terraform apply`, Atlantis, Spacelift, CI-driven.
- **Destructive-change warnings** — resources where `terraform apply` could cause data loss / downtime if attributes change (databases, persistent volumes, IAM roles in use, DNS records). Call these out explicitly so an agent thinks twice.

Strong candidate for `architecture.md`, `build-and-run.md`. Skip `ui.md`.

---

## Data pipeline

**Top emphasis:** sources, sinks, scheduling, and the idempotency / replay story.

Capture:
- Orchestrator (Airflow, Dagster, Prefect, Argo, cron + scripts) and where DAGs/flows are defined.
- Data sources (DBs, APIs, files, streams) with locations.
- Sinks (warehouse, lake, downstream service).
- Schedule / trigger model.
- Idempotency: can a job be safely re-run? Are outputs partitioned by date / batch id?
- Failure handling: retries, backfill mechanism, alerting.
- Schema management — dbt models, schema migrations, contract testing.

Strong candidate for `architecture.md`, `data-model.md`, `flows.md`, `integrations.md`.

---

## Other / hybrid

If the project doesn't fit cleanly into a single archetype:

- **Pick the dominant archetype** for `PROJECT_SUMMARY.md`'s `Type` field — but be explicit when it's hybrid. Example labels: "Go single-binary CLI with embedded HTTP daemon and React SPA", "monorepo containing a Go API + React admin UI + Terraform for AWS", "Python CLI that's also a publishable library".
- **Use deep-dives to cover the secondary concerns** rather than cramming everything into the top-level doc. A CLI-with-embedded-server, for example, often warrants both a CLI-style commands list in PROJECT_SUMMARY *and* a web-service-flavored `architecture.md` / `flows.md` describing the daemon side.
- **The secondary archetype's emphasis still applies in its own deep-dive.** If the daemon side has routes, middleware, and a request lifecycle, write them in `architecture.md` / `flows.md` even though the top-level type is "CLI tool". Don't suppress relevant sections just because they don't match the dominant flavor.

### Common hybrid combinations

- **CLI + HTTP daemon** (e.g. a CLI that can also `serve`) — top type "CLI"; warrants web-service-flavored `architecture.md`, `flows.md`, and likely `build-and-run.md` for the embed/asset story.
- **CLI + library** (a Python or Node tool that's also importable) — top type "CLI" or "Library", whichever surface is more used; document both public APIs in PROJECT_SUMMARY.
- **Service + frontend in one repo** — top type "Web service" if the frontend is admin/internal; "Web app" if the frontend is the product. Use `ui.md` + `architecture.md` to keep them clearly separated.
- **App + IaC in same repo** — keep the app summary primary; relegate Terraform / Helm / Kustomize details to `build-and-run.md` (or its own `infra.md` if extensive).

---

## Cross-cutting: non-standard organizational choices

Across all archetypes: when you spot a project making a deliberate but unusual choice, **call it out so the next agent doesn't "fix" it**.

Common examples:
- Single types file for a component library instead of per-component types
- Hand-rolled CLI dispatcher instead of cobra/clap/argparse
- Flat `package main` instead of `cmd/` + `internal/` for a small Go tool
- BEM-style class names when the surrounding ecosystem uses CSS Modules
- Inline scripts in `package.json` instead of a `scripts/` directory
- Embedded SQL strings instead of an ORM, or vice versa for a project where the alternative is more idiomatic

Frame these as *"This looks unusual but is intentional — see `<file>` and don't refactor without the maintainer's input."* The canonical home is `conventions.md`'s "Don't refactor" section, or PROJECT_SUMMARY's "Things to avoid" if there's no full conventions file.
