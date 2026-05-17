# Migration modes

Three modes. The skill asks the user to pick at Phase 2.

## Decision matrix

| Question | Full rewrite | Strangler-fig | Module-by-module |
|---|---|---|---|
| Can the team afford a multi-week freeze on Java changes? | Yes | No | Partial |
| Is there a reverse proxy in front of the service? | N/A | Required | Optional |
| Do modules have clean dependency boundaries? | N/A | Required for shared state | Required |
| Does the service have a public API SLA? | Risky | Safe | Safe |
| Estimated effort multiplier vs full rewrite | 1× | 1.5–2× | 1.2–1.5× |

## Full rewrite

Use when: the service is small (<10 KLOC Java), the team can freeze Java changes for the duration, and there's no live multi-team SLA.

Procedure:
1. Phase 1 over the whole repo.
2. Phase 2 plan covers all modules at once.
3. Phase 3 ports all modules; no Java code runs in parallel.
4. Cut over at deployment.

Risk: every bug in the port is a production bug at cut-over.

## Strangler-fig (Martin Fowler pattern)

Use when: the service has a live SLA, multiple teams depend on it, and you can put a reverse proxy in front.

Procedure:
1. Phase 1 over the whole repo.
2. Phase 2 plan picks ONE route (or a small set) to port first.
3. Phase 3 ports that route to TS; deploy the TS service alongside Java.
4. Configure the proxy (Nginx, Envoy, HAProxy) to route `/users/*` to TS, everything else to Java.
5. Run Phase 4 to verify the ported routes match Java byte-for-byte.
6. Repeat 2–5 for the next route until Java has nothing left.
7. Decommission Java.

Skill scaffolds:
- `proxy/nginx.conf` (or equivalent) with explicit route-by-route mapping
- `migration/proxy-routes.md` documenting which routes live in which stack at each migration step
- Shared `contracts/` directory with zod schemas that both stacks must conform to (Java uses jsonschema generated from zod via zod-to-json-schema)

## Module-by-module

Use when: the Java repo has clean module boundaries (e.g., `api/`, `core/`, `worker/`), and you can ship modules independently without a live proxy.

Procedure:
1. Phase 1 builds the dependency DAG between modules.
2. Phase 2 plans the port order — leaves of the DAG first (modules with no internal deps), root last.
3. Phase 3 ports modules one at a time; intermediate state is `core (TS) + api (Java still calling core via JNI shim or process boundary)`. Use whichever IPC mechanism the existing Java already supports.
4. Phase 4 runs once per ported module (against its public API).

This mode is the middle ground: lower risk than full rewrite, less infra than strangler-fig.

## Always (regardless of mode)

- `migration/` is gitignored in the Java repo (skill adds the entry).
- Every phase's artifact is committed-by-user-choice only — the skill never auto-commits.
- The skill never starts services. The user starts Java and TS.
- Phase 2 user gate is hard. Phase 4 acceptance gate is hard.
