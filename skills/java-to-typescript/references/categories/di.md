# Dependency Injection (Spring DI → tsyringe)

## Why tsyringe

Per the default_picks: lightweight, decorator-based, plays well with TypeScript's `experimentalDecorators`. Closest mental model to Spring's `@Component` + constructor injection. Alternatives (awilix, InversifyJS) listed in the registry; tsyringe is the v1 default.

## Setup

1. `tsconfig.json` MUST have `experimentalDecorators: true` and `emitDecoratorMetadata: true` (set by the scaffolder; do not remove).
2. The very first import in your entry point MUST be `import 'reflect-metadata';`. Without it, decorator metadata silently breaks.
3. Tests that resolve from `container` must also import `'reflect-metadata'` at the top.

## Registration patterns

```typescript
// src/wiring.ts — one wiring file per module
import { container } from 'tsyringe';
import { UserService } from './services/user-service.js';
import { db } from './db/client.js';

container.register('Db', { useValue: db });
container.register('UserService', { useClass: UserService });
container.register('Clock', { useFactory: () => ({ now: () => new Date() }) });
```

## Class-level decoration

```typescript
import { injectable, inject } from 'tsyringe';
import type { Database } from 'drizzle-orm/node-postgres';

@injectable()
export class UserService {
  constructor(@inject('Db') private db: Database) {}

  async getUser(id: bigint): Promise<User | undefined> {
    return this.db.select().from(users).where(eq(users.id, id)).then((r) => r[0]);
  }
}
```

## What does NOT translate

| Spring | Why and what to do instead |
|---|---|
| `@Autowired` on fields | tsyringe only supports constructor injection. Refactor. |
| Classpath scanning | Register beans explicitly in `wiring.ts`. |
| AOP (`@Around`, `@Before`) | Wrap manually: write a higher-order function and apply at the call site. |
| `@PostConstruct` | Initialize in the constructor; for async init, expose an `async init()` and call from `wiring.ts`. |
| Bean lifecycle (`@PreDestroy`) | Wire shutdown handlers in `server.ts` (see `runtimes/node.md`). |
| Spring profiles | Drive via env + zod-validated config (see `categories/config.md`). |

## Method-level authorization

Spring's `@PreAuthorize("hasRole('ADMIN')")` → an explicit guard helper called at the start of the method:

```typescript
async deleteUser(id: bigint, actor: Actor): Promise<void> {
  requireRole(actor, 'ADMIN');
  // ...
}
```

Do not introduce an aspect framework.
