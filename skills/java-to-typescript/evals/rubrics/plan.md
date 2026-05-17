# Plan rubric template (E2)

LLM-judge prompt skeleton for evaluating `migration/plan.md` against per-fixture `expected/plan-rubric.md`.

## Scoring

Score on the 0–10 scale defined in the per-fixture rubric. Sum the per-item points; total is the score.

## What "good" looks like

A passing plan:
- Identifies every Maven module in the source repo.
- Picks a TS framework / DI / validation library per module, with the registry defaults applied unless the user overrode at Phase 2.
- Surfaces every `unmappedDependencies` entry to the user as an explicit question (not silently chosen).
- Orders modules for porting by dependency DAG (leaves first).
- Includes a per-module diff preview.

## Failure modes the judge MUST flag

- Hallucinated dependencies not in the source pom/gradle.
- TS library picks not present in `library-map.yaml` and not flagged for user input.
- Skipped modules.
- Skipped phases.

## Variance handling

LLM-judged. Run 5 times. Report mean ± stddev. Compare against the previous skill version using the rule: "improvement only if mean delta > 1 stddev."
