# Canonical TS shape for spring-boot-users port

A passing port produces this structure. Idioms checked: one handler per file, DTO ≡ zod schema, repository ≡ drizzle query module, config ≡ zod env, logger ≡ pino child, errors ≡ subclass.

```
api/
├── package.json                    # express, tsyringe, zod, pino, decimal.js, drizzle-orm
├── tsconfig.json                   # extends ../tsconfig.base.json
└── src/
    ├── server.ts                   # imports app, listens, graceful shutdown
    ├── app.ts                      # buildApp() — express + middleware + routes
    ├── wiring.ts                   # tsyringe registrations
    ├── config.ts                   # zod-parsed env
    ├── logger.ts                   # baseLogger + module export
    ├── middleware/errors.ts        # ZodError + UsersError → HTTP
    ├── schemas/user.ts             # CreateUserSchema, UserResponseSchema
    ├── routes/get-user.ts          # GET /users/:id handler
    └── routes/create-user.ts       # POST /users handler

core/
├── package.json                    # drizzle-orm, decimal.js
├── tsconfig.json
└── src/
    ├── db/
    │   ├── schema.ts               # drizzle table for users
    │   └── client.ts               # pool + db export
    ├── repos/user.ts               # makeUserRepo: { findById, insert }
    ├── services/user-service.ts    # @injectable() with @inject('UserRepo')
    └── errors.ts                   # UsersError base class
```

## Type-fidelity checks
- `User.id` is `bigint` (per "Long used as entity ID")
- `User.balance` is `Decimal` from decimal.js (per "BigDecimal always")
- `User.createdAt` is `Date` (per "Instant → Date")
- HTTP response serializes `id` as string and `balance` via `.toString()`

## Forbidden shapes (each costs 2 points in the port rubric)
- An `AbstractUserService` or `BaseRepository` interface that's only used once
- A `UserRepositoryImpl` that wraps a drizzle call to fake JPA
- A `ResponseEntity<T>` shim
- A `config.ts` that calls `process.env.X` more than once
