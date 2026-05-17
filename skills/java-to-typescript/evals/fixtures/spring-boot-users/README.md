# Fixture: spring-boot-users

Minimal Spring Boot service used by the M0 eval suite.

- **Modules:** `core` (entity + repository + service), `api` (controller + Spring Boot main)
- **Endpoints:**
  - `GET /users/{id}` — fetch one user
  - `POST /users` — create user
- **DB:** in-memory H2 (eval mode) so the fixture is self-contained
- **Java version:** 21
- **Spring Boot version:** 3.3.x

## How E1 (analyze accuracy) uses this fixture

`evals/runner.ts runE1` calls `analyze(<this>/java)` and deep-equals the result against `expected/analysis.json`. Any drift in the analyze script (or a new known library not yet added to the registry) shows up immediately.

## How E4 (contract parity) uses this fixture

Manual / out-of-CI:
1. `cd java && mvn spring-boot:run -pl api`
2. `record-fixtures --java-base http://localhost:8080 --corpus expected/corpus.jsonl --out /tmp/fixtures.jsonl`
3. (After porting) `replay-fixtures --ts-base http://localhost:3000 --fixtures /tmp/fixtures.jsonl --allowlist expected/allowlist.json --report /tmp/r.md`
