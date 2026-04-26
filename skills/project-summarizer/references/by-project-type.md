# By Project Type

Quick guide to what to emphasize when summarizing different kinds of projects. Read this when you've identified the project type during Step 2 and want to focus your sampling and documentation effort.

If a project is genuinely hybrid (e.g. monorepo with a CLI + web app + Terraform), pick the dominant flavor for the top-level summary and use deep-dives for the rest.

---

## CLI tool

**Top emphasis:** the user-facing surface (commands, flags, exit codes) and where business logic separates from CLI plumbing.

Capture:
- The argv-parsing library (`cobra`, `clap`, `argparse`, `commander`) and where commands are registered.
- A list of subcommands and their entry handlers.
- The convention for error → exit code mapping (e.g. "non-zero on any error; specific codes for `EX_USAGE`, `EX_DATAERR`").
- Where I/O happens vs. where pure logic lives — agents adding a new command need to know the seam.
- Output formats (human / JSON / quiet) and how they're switched.

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

Skip / shrink: deployment, infra. Libraries rarely have those.

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

If the project doesn't fit cleanly:
- Pick the single closest archetype above for shape.
- In `PROJECT_SUMMARY.md`'s `Type` field, be explicit: e.g. "monorepo containing a Go API, a React admin UI, and Terraform for AWS".
- Use deep-dives to cover the secondary concerns rather than cramming everything into the top-level doc.
