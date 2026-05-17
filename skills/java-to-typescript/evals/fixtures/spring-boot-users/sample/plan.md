# Migration Plan: spring-boot-users → TypeScript

## 1. Detected source layout

The Maven analyzer identified **two modules** under `com.example`:

| Module | Path  | Packaging | Detected framework |
|--------|-------|-----------|---------------------|
| core   | core/ | jar       | spring-boot         |
| api    | api/  | jar       | spring-boot         |

Both modules are Spring Boot 3.3.x, Java 21. `api` depends on `core`.

## 2. Target stack

Mapping to the project default TypeScript stack:

- **HTTP framework:** Express 5 (maps to `spring-boot-starter-web`)
- **DI container:** tsyringe (maps to Spring's `@Component` / `@Service`)
- **Validation:** zod (maps to `spring-boot-starter-validation` / `@Valid` + Jakarta Validation)
- **Logger:** pino (maps to Spring's logback default)
- **ORM:** drizzle-orm (maps to `spring-boot-starter-data-jpa` + Hibernate)
- **Decimal type:** decimal.js (maps to `java.math.BigDecimal`)
- **Date/time:** temporal-polyfill (maps to `java.time.Instant`) — used only if Instant escapes domain boundaries; here `Date` suffices for `createdAt`, so temporal-polyfill is **omitted** from the projected deps.

No override requested; defaults apply.

## 3. Unmapped dependencies — needs user input

| Dependency           | Module | Reason unmapped                                                              |
|----------------------|--------|------------------------------------------------------------------------------|
| `com.h2database:h2`  | core   | In-process H2 has no direct TS analog. Drizzle needs a real driver target.   |

**Question for the user:** which DB driver should the port target?
- (a) `postgres` (recommended for prod parity; use `pg` + `drizzle-orm/node-postgres`)
- (b) `better-sqlite3` (closest to H2's in-process feel; good for tests/dev)
- (c) other

Pausing the plan until you confirm. The rest of the plan assumes **(a) postgres** for projection.

## 4. Port order

Dependency-correct order — `api` imports from `core`, so `core` must land first:

1. **core** (entity + repository + service)
2. **api** (controller + bootstrap)

## 5. Migration mode

**`full-rewrite`** per module. Rationale:

- The codebase is small (2 modules, ~5 source files each).
- No live traffic to preserve.
- Strangler-fig would require a long-lived JVM + Node side-by-side rig for marginal benefit and would over-engineer a fixture-sized service.

## 6. Projected per-module `package.json`

### core/package.json
```json
{
  "name": "@spring-boot-users/core",
  "private": true,
  "type": "module",
  "dependencies": {
    "drizzle-orm": "^0.36.0",
    "decimal.js": "^10.4.3",
    "pg": "^8.13.0",
    "tsyringe": "^4.8.0",
    "reflect-metadata": "^0.2.2"
  },
  "devDependencies": { "typescript": "^5.6.0", "tsx": "^4.19.0", "vitest": "^2.1.0" }
}
```

### api/package.json
```json
{
  "name": "@spring-boot-users/api",
  "private": true,
  "type": "module",
  "dependencies": {
    "express": "^5.0.0",
    "tsyringe": "^4.8.0",
    "reflect-metadata": "^0.2.2",
    "zod": "^3.23.0",
    "pino": "^9.5.0",
    "@spring-boot-users/core": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.6.0", "tsx": "^4.19.0", "vitest": "^2.1.0", "@types/express": "^5.0.0" }
}
```

`temporal-polyfill` is intentionally absent — no Instant fields escape the domain.

## 7. Diff preview per module

### core (Java → TS)
```
- core/src/main/java/com/example/User.java               (@Entity, Long id, BigDecimal balance, Instant createdAt)
- core/src/main/java/com/example/UserRepository.java     (JpaRepository<User, Long>)
- core/src/main/java/com/example/UserService.java        (@Service)
+ core/src/db/schema.ts                                  (drizzle pgTable: bigint id, text name, numeric balance, timestamp createdAt)
+ core/src/db/client.ts                                  (pg Pool + drizzle())
+ core/src/repos/user.ts                                 (makeUserRepo: findById, insert)
+ core/src/services/user-service.ts                      (@injectable UserService)
+ core/src/errors.ts                                     (UsersError base class)
```

### api (Java → TS)
```
- api/src/main/java/com/example/UserController.java      (@RestController, @GetMapping, @PostMapping)
- api/src/main/java/com/example/Application.java         (@SpringBootApplication)
+ api/src/server.ts                                      (createServer + listen + graceful shutdown)
+ api/src/app.ts                                         (buildApp(): express + middleware + routes)
+ api/src/wiring.ts                                      (tsyringe container.register(...))
+ api/src/config.ts                                      (zod-parsed process.env, single call)
+ api/src/logger.ts                                      (pino base + child)
+ api/src/middleware/errors.ts                           (ZodError → 400, UsersError → mapped status)
+ api/src/schemas/user.ts                                (CreateUserSchema, UserResponseSchema)
+ api/src/routes/get-user.ts                             (GET /users/:id)
+ api/src/routes/create-user.ts                          (POST /users)
```

## 8. Awaiting confirmation

Confirm the DB driver choice in §3, then I'll proceed module-by-module per §4.
