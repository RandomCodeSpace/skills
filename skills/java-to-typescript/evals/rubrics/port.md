# Port rubric template (E3)

LLM-judge prompt skeleton for evaluating the produced TS workspace against per-fixture `expected/ts-shape.md`.

## Hard gates (0 or 10)
- `tsc --noEmit` clean across all workspaces.
- All ported Vitest tests pass.

A failure on either = 0 for the entire E3 score (not just for the hard-gate dimension).

## Scored dimensions (each 0–10, averaged)

### Framework idioms (0–10)
- One handler per file? (0–2)
- DTOs are zod schemas with inferred types? (0–2)
- Repositories are Drizzle queries, not faked JPA interfaces? (0–2)
- Config is a single zod-parsed env object per module? (0–2)
- Logger is module-scoped pino child? (0–2)

### Type fidelity (0–10)
- BigDecimal preserved as Decimal? (0–3)
- IDs typed as bigint (or branded string) consistently? (0–3)
- Optional<T> rendered per policy? (0–2)
- LocalDate / ZonedDateTime via Temporal polyfill? (0–2)

### Migration discipline (0–10)
- port-log.md records every non-trivial decision? (0–4)
- No dead Java-style abstractions ported over? (0–3)
- No policy violations without a port-log entry? (0–3)
