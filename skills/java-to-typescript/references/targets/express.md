# Express target reference

Default target for Spring Boot / Quarkus / Micronaut / Spring MVC ports unless the user overrides.

## Skeleton module structure

```
src/
├── app.ts          # builds the express app; exports for tests
├── server.ts       # imports app + listens; the actual entry point
├── wiring.ts       # tsyringe container.register calls
├── config.ts       # const AppConfig = z.object(...).parse(process.env)
├── logger.ts       # const baseLogger = pino(...); export logger
├── routes/         # one file per handler
├── services/       # one file per service class
├── repos/          # one file per repository (drizzle query module)
├── schemas/        # one file per DTO (zod schema + z.infer type)
└── db/
    └── schema.ts   # drizzle table definitions
```

## `app.ts` skeleton

```typescript
import 'reflect-metadata';
import express from 'express';
import { container } from 'tsyringe';
import { logger } from './logger.js';
import './wiring.js';
import { errorHandler } from './middleware/errors.js';
import { mountUserRoutes } from './routes/index.js';

export function buildApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { logger.info({ m: req.method, u: req.url }, 'req'); next(); });
  mountUserRoutes(app);
  app.use(errorHandler);
  return app;
}
```

## DI integration (tsyringe)

- `import 'reflect-metadata'` MUST be the first import in `app.ts` (and in tests that resolve DI).
- `tsconfig.json` must have `experimentalDecorators: true` and `emitDecoratorMetadata: true`.
- Register tokens in `wiring.ts`:

```typescript
import { container } from 'tsyringe';
import { UserService } from './services/user-service.js';
import { db } from './db/client.js';

container.register('Db', { useValue: db });
container.register('UserService', { useClass: UserService });
```

## Validation (zod)

Validate every HTTP boundary:

```typescript
import { z } from 'zod';
import type { Request, Response } from 'express';

export const CreateUserSchema = z.object({ name: z.string().min(1), email: z.string().email() });
export type CreateUser = z.infer<typeof CreateUserSchema>;

export async function createUserHandler(req: Request, res: Response): Promise<void> {
  const dto = CreateUserSchema.parse(req.body); // throws ZodError → caught by errorHandler
  // ... call service ...
  res.status(201).json(/* created */);
}
```

## Error mapping middleware

```typescript
import { ZodError } from 'zod';
import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) { res.status(400).json({ errors: err.errors }); return; }
  if (err instanceof UsersError) { res.status(err.status).json({ error: err.message }); return; }
  res.status(500).json({ error: 'internal' });
};
```

## What Express does NOT give you (and how to add it)

| Need | Add |
|---|---|
| Schema-first → OpenAPI | `zod-to-json-schema` + manual `/openapi.json` route |
| Async route handlers without try/catch boilerplate | Tiny `asyncRoute(fn)` wrapper or `express-async-errors` (small, MIT) |
| Request-scoped DI | Use tsyringe child container per request via middleware |
| Built-in CORS | `cors` package |
