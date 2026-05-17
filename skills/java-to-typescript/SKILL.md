---
name: java-to-typescript
description: Use when migrating a Java service (Spring Boot, Quarkus, Micronaut, Spring MVC) to TypeScript. Supports full rewrite, strangler-fig, and module-by-module modes; targets Node (default), Bun, or Deno on Express, Koa, Hono, or Restify, with contract-parity verification against the original Java service.
---

# java-to-typescript

Migrate a Java HTTP service to TypeScript across four phases with explicit user gates. The LLM owns every translation decision; the bundled scripts only do deterministic plumbing (XML parsing, workspace scaffolding, HTTP capture, JSON diff). No runtime internet access is required.

## When to use

Invoke when the user asks to port, migrate, or rewrite a Java service in TypeScript. Detect Spring Boot / Quarkus / Micronaut / Spring MVC by scanning `pom.xml` or `build.gradle[.kts]` for the canonical dependency coords.

Do not use for: GraphQL Java migrations, Akka/Pekko, Android, JNI, Java agents, or pure-library JARs without an HTTP surface.

## Hard constraints

1. The LLM does every translation. Scripts never translate, never decide a library choice, never write source code. They produce JSON, JSONL, or templated config files only.
2. No runtime internet. The registry at `references/library-map.yaml` is the only source of library-mapping truth. Unmapped libraries escalate to the user via `AskUserQuestion` — never silently auto-fill, never call `context7` at runtime.
3. Never skip a phase. Phase 2 is a hard user gate; Phase 4 is the acceptance gate.

## The four phases

### Phase 1 — Analyze (read-only)

Run:

```
tsx scripts/pom-to-workspace.ts analyze --repo <java-repo>
```

This writes `<java-repo>/migration/analysis.json` with detected build system, modules, framework per module, dependency inventory, and any `unmappedDependencies`. Cross-reference dependencies against `references/library-map.yaml`.

Consult: `references/library-map.yaml`, `references/frameworks/*.md`.

### Phase 2 — Plan (hard user gate, diff preview)

Ask the user via `AskUserQuestion` for:

- Migration mode (`full-rewrite | strangler-fig | module-by-module`) — consult `references/migration-modes.md`.
- Target TS framework per Java module (Express default; Koa, Hono, Restify selectable) — consult `references/targets/*.md`.
- Runtime (Node default; Bun, Deno opt-in) — consult `references/runtimes/*.md`.
- Package manager (npm default; pnpm, yarn, bun opt-in).
- DI library (tsyringe default).
- Validation library (zod default).

For each entry in `analysis.json.unmappedDependencies`, ask the user via `AskUserQuestion` for a target. Do not auto-resolve. Do not call `context7`.

Write `<java-repo>/migration/plan.md` containing per-module decisions, dependency order, and a one-shot diff preview (per module: what gets created, what the projected `package.json` looks like, which Java files map to which TS files).

**Gate:** wait for explicit user approval of `plan.md` before Phase 3.

Consult: `references/migration-modes.md`, `references/targets/*.md`, `references/runtimes/*.md`, `references/build-layout.md`, `references/type-fidelity.md`.

### Phase 3 — Port

Order:

1. Write `<java-repo>/migration/scaffold.json` (derived from `plan.md`). Run `tsx scripts/pom-to-workspace.ts scaffold --plan <java-repo>/migration/scaffold.json --out <ts-repo>`. This emits root `package.json`, per-module `package.json`, `tsconfig.json`, `vitest.config.ts`, and `.gitignore`. No source code.

2. Port deterministic surfaces first, per module: config (zod-validated env), DTOs (zod schemas), entities (Drizzle schema), validation rules. Consult `references/categories/{config,validation,persistence}.md` and `references/type-fidelity.md`.

3. Port handlers one at a time, smallest module first. For each handler: read Java source → consult `references/frameworks/<source>.md` + `references/targets/<target>.md` → emit TS → run `tsc --noEmit` on the touched module → append a one-line entry to `<java-repo>/migration/port-log.md` recording any non-trivial decision.

4. Port tests alongside each handler. Map JUnit→Vitest, Mockito→`vi.mock`, AssertJ→`expect`, Testcontainers→testcontainers-node. Consult `references/categories/testing.md`.

5. Apply type-fidelity policy per `references/type-fidelity.md`. Deviations require a one-line `port-log.md` entry.

6. Dispatch one subagent per independent module via `superpowers:subagent-driven-development` when the dependency graph permits parallelism.

**Non-negotiable patterns** (from `references/type-fidelity.md` §7.3):
- One handler per file.
- DTO ≡ zod schema. No interfaces on HTTP boundaries without a schema.
- Repository ≡ Drizzle query module. No faked JPA repository interfaces.
- Config ≡ single zod-parsed env object per module. No scattered `process.env.FOO`.
- Logger ≡ module-scoped pino child. No `console.log`.
- Errors ≡ subclasses of a per-module base class, mapped to HTTP status via single middleware.

### Phase 4 — Verify (acceptance gate)

The user starts both the Java service (`localhost:<javaPort>`) and the TS service (`localhost:<tsPort>`). The skill prints the expected commands and waits — it never boots services itself.

1. Generate `<java-repo>/migration/corpus.jsonl` from Java controller signatures + sample DB state. Ask the user to review or extend before recording.

2. Run:

   ```
   tsx scripts/record-fixtures.ts --java-base http://localhost:<javaPort> --corpus migration/corpus.jsonl --out migration/fixtures.jsonl
   ```

3. Write `<java-repo>/migration/allowlist.json` declaring paths expected to differ (timestamps, generated IDs, trace headers). Schema:

   ```json
   { "headers": ["x-request-id", "date", "traceparent"],
     "bodyPaths": ["$.createdAt", "$.updatedAt"],
     "arrayKeys": { "$.items": "id" } }
   ```

4. Run:

   ```
   tsx scripts/replay-fixtures.ts --ts-base http://localhost:<tsPort> --fixtures migration/fixtures.jsonl --allowlist migration/allowlist.json --report migration/verify-report.md
   ```

5. Run the ported Vitest suite from the TS workspace root.

**Acceptance gate (both required):** zero unexpected diffs in `verify-report.md` AND all ported Vitest suites green.

Consult: `references/categories/testing.md`.

## Migration artifact location

All artifacts (`analysis.json`, `plan.md`, `scaffold.json`, `corpus.jsonl`, `fixtures.jsonl`, `allowlist.json`, `port-log.md`, `verify-report.md`, `verify-report.json`) live in `<java-repo>/migration/`. On first run, the skill adds `migration/` to the target repo's `.gitignore`.

## When stuck

- Library not in registry: ask the user via `AskUserQuestion`. Do not invent a mapping.
- Build-system parse warnings (Gradle Kotlin DSL with dynamic deps): show the warning verbatim to the user; ask them to confirm the dependency list.
- Phase 4 unexpected diffs: report each diff with the Java side and TS side excerpted; return to Phase 3 for the responsible handler.
- Tests fail after porting: do not weaken assertions to make them pass. Diagnose root cause; if the Java behavior cannot be replicated, escalate.
