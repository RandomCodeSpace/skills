# Plan rubric for spring-boot-users

Score 0–10. A passing plan must mention each of the following correctly.

| Item | Points |
|---|---|
| Identifies both modules (api, core) and their detected framework (spring-boot) | 1 |
| Picks Express + tsyringe + zod as the target (or documents an explicit override) | 1 |
| Flags h2 as an unmapped dependency and asks the user for a target DB driver | 2 |
| Orders core before api (dependency-correct port order) | 2 |
| Includes a per-module projected package.json showing drizzle-orm + decimal.js + temporal-polyfill (or notes their absence and why) | 1 |
| Picks a migration mode (full-rewrite is the right call here; strangler would be over-engineering) | 1 |
| Includes the diff preview per module | 2 |
