# Evals

How to run the eval suite for the `java-to-typescript` skill.

## Eval types

| ID | What it measures | Determinism | When it runs |
|---|---|---|---|
| E1 | Analyze accuracy (Phase 1) | deterministic | every PR |
| E2 | Plan reasonability (Phase 2) | LLM-judged | tag releases / on demand |
| E3 | Port quality (Phase 3) | hybrid (hard `tsc`+tests; idioms LLM-judged) | tag releases / on demand |
| E4 | Contract parity (Phase 4) | deterministic | manual smoke; CI optional |

## Quick start

```bash
# All evals against the default fixture (spring-boot-users)
npx tsx evals/runner.ts --eval all

# Specific eval
npx tsx evals/runner.ts --eval E1
npx tsx evals/runner.ts --eval E2 --runs 5
npx tsx evals/runner.ts --eval E3 --runs 5

# Specific fixture
npx tsx evals/runner.ts --fixture spring-boot-users --eval E1

# Override the plan/port being judged (defaults to sample/plan.md and sample/ts-port/api)
npx tsx evals/runner.ts --eval E2 --plan /tmp/my-plan.md
npx tsx evals/runner.ts --eval E3 --ts-repo /tmp/my-ts-port
```

Vitest also exercises the deterministic + mock-mode paths:

```bash
npx vitest run evals/__tests__/runner.test.ts
npx vitest run evals/__tests__/judge.test.ts
```

## Flags

| Flag | Default | Notes |
|---|---|---|
| `--fixture <name>` | `spring-boot-users` | Picks fixture under `evals/fixtures/<name>/` |
| `--eval <id>` | `all` | `E1`, `E2`, `E3`, or `all` (E4 is invoked separately via `replay-fixtures.ts`) |
| `--runs <n>` | `1` for deterministic evals, `5` for LLM-judged | N runs aggregated into `mean ± stddev` |
| `--plan <path>` | `<fixture>/sample/plan.md` | Plan content for E2 to judge |
| `--ts-repo <path>` | `<fixture>/sample/ts-port/api` | TS workspace for E3 to gate + judge |

## Judge modes (E2 + E3)

The judge in `evals/judge.ts` runs in two modes:

| Mode | Trigger | Behavior |
|---|---|---|
| **Mock** (default) | Either `MOCK_JUDGE` is unset/non-`0` OR `ANTHROPIC_API_KEY` is absent | Returns a deterministic score in 7-9 derived from `sha256(content + rubric)`. Free, fast, CI-safe, no network. |
| **Real** | `MOCK_JUDGE=0` AND `ANTHROPIC_API_KEY=sk-...` both set | Calls `claude-haiku-4-5-20251001` with the rubric + content + judge instructions, parses a `{score, rationale}` JSON response. |

```bash
# Run E2 + E3 with the real Anthropic judge
MOCK_JUDGE=0 ANTHROPIC_API_KEY=sk-ant-... \
  npx tsx evals/runner.ts --eval all --runs 5
```

The real-mode test in `evals/__tests__/judge.test.ts` is auto-skipped when the env vars aren't set, so CI never accidentally hits the API.

## Variance handling

LLM-judged evals (`E2`, `E3` idiom dimension) run N times (default 5). Output is `mean ± stddev`. Sample-stddev with `n-1` denominator. The rule for accepting a skill change as an improvement: **mean delta must exceed 1 stddev** of the prior baseline.

Mock mode produces `stddev=0` because the hash is deterministic — useful for verifying the harness wiring, not for measuring real model judgment.

## Sample inputs (reference shapes E2/E3 judge against)

Per fixture, `sample/` holds reference inputs:

- `sample/plan.md` — example of what a passing Phase 2 plan looks like
- `sample/ts-port/<module>/` — minimal but tsc-clean + vitest-green reference TS workspace

These are *examples* for E2/E3 in mock mode. In real mode against a real migration, you'd pass `--plan /path/to/your/migration/plan.md` and `--ts-repo /path/to/the/produced/ts-workspace`.

## Adding a new fixture

1. `mkdir -p evals/fixtures/<name>/{java,expected,sample}`.
2. Populate `java/` with a minimal runnable Spring Boot / Quarkus / Micronaut / Spring MVC project.
3. Run analyze: `npx tsx scripts/pom-to-workspace.ts analyze --repo evals/fixtures/<name>/java`.
4. Copy `evals/fixtures/<name>/java/migration/analysis.json` to `evals/fixtures/<name>/expected/analysis.json`.
5. Write `expected/corpus.jsonl`, `expected/allowlist.json`, `expected/ts-shape.md`, `expected/plan-rubric.md`.
6. Hand-author `sample/plan.md` (covering every rubric item) + `sample/ts-port/<module>/` (a minimal TS port that compiles + has at least one passing test).
7. Re-run `evals/__tests__/runner.test.ts` to verify E1 + E2 + E3 against the new fixture.

## CI integration

`.github/workflows/eval.yml` runs typecheck + unit tests + E1 on every PR touching `skills/java-to-typescript/**`. E2/E3 in mock mode are exercised by the unit test suite (`runner.test.ts` + `judge.test.ts`). Real-mode E2/E3 against actual Claude API is opt-in only — run manually on tag releases with the env vars set, or wire a separate workflow keyed to `ANTHROPIC_API_KEY` secret if you want it on every release.

## Air-gap note

Evals never hit the public internet in mock mode. In real mode, only the Anthropic API is contacted (egress to `api.anthropic.com` over HTTPS). Java fixtures must compile against locally vendored Maven repositories (Artifactory / Nexus / proxied central). The eval runner itself only parses XML and connects to `localhost` for E4.
