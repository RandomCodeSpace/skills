# Evals

How to run the eval suite for the `java-to-typescript` skill.

## Eval types

| ID | What it measures | Determinism | When it runs |
|---|---|---|---|
| E1 | Analyze accuracy (Phase 1) | deterministic | every PR |
| E2 | Plan reasonability (Phase 2) | LLM-judged | tag releases / on demand |
| E3 | Port quality (Phase 3) | hybrid (hard `tsc`+tests; idioms LLM-judged) | tag releases / on demand |
| E4 | Contract parity (Phase 4) | deterministic | manual smoke; CI optional |

## Commands

```bash
# All deterministic evals (E1; E4 requires live services)
npx tsx evals/runner.ts --eval E1

# Specific fixture
npx tsx evals/runner.ts --fixture spring-boot-users --eval E1

# Via vitest (uses runE1 directly)
npx vitest run evals/__tests__/runner.test.ts
```

## Adding a new fixture

1. `mkdir -p evals/fixtures/<name>/{java,expected}`.
2. Populate `java/` with a minimal runnable Spring Boot / Quarkus / Micronaut / Spring MVC project.
3. Run the analyze script: `npx tsx scripts/pom-to-workspace.ts analyze --repo evals/fixtures/<name>/java`.
4. Copy `evals/fixtures/<name>/java/migration/analysis.json` to `evals/fixtures/<name>/expected/analysis.json`.
5. Write `expected/corpus.jsonl`, `expected/allowlist.json`, `expected/ts-shape.md`, `expected/plan-rubric.md`.
6. Add a `it.each(['<name>', ...])` entry in `evals/__tests__/runner.test.ts`.

## Air-gap note

Evals never hit the public internet. Java fixtures must compile against locally vendored Maven repositories (Artifactory / Nexus / proxied central). The eval runner itself only parses XML and HTTP-localhost.
