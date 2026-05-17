# Configuration (`@ConfigurationProperties` → zod-validated env)

## The rule

Each module has exactly ONE `config.ts` that:
1. Defines a zod schema describing every env var the module reads.
2. Parses `process.env` against the schema at module load.
3. Exports a typed `config` object.

No scattered `process.env.FOO` reads anywhere else in the module.

## Skeleton

```typescript
// src/config.ts
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  SERVICE_NAME: z.string().default('users'),
});

export type Config = z.infer<typeof ConfigSchema>;

export const config: Config = (() => {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('config: invalid environment variables:', parsed.error.format());
    process.exit(1);
  }
  return parsed.data;
})();
```

Fail-fast on bad config is intentional: it surfaces missing/wrong vars at startup, not at first request.

## `@ConfigurationProperties("app")` → grouped config

Spring's grouped properties (`app.cache.ttl-seconds`, `app.cache.max-size`) → flat env var names by convention:

| Spring property | env var |
|---|---|
| `app.cache.ttl-seconds` | `APP_CACHE_TTL_SECONDS` |
| `db.pool.max` | `DB_POOL_MAX` |

Group in the schema:

```typescript
const CacheConfigSchema = z.object({
  APP_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  APP_CACHE_MAX_SIZE: z.coerce.number().int().positive().default(1000),
});

// access:
config.APP_CACHE_TTL_SECONDS
```

## Profiles → env

Spring profiles (`application-dev.yml`, `application-prod.yml`) → a single `.env.<profile>` loaded via `dotenv-flow` or by your deploy system. Don't try to load YAML at runtime.

## Secrets

Same convention. The schema accepts them via env vars; the deploy system (Kubernetes secrets, Vault, AWS SSM) is responsible for populating env. Never log a secret — pino's `redact` option:

```typescript
const baseLogger = pino({ redact: ['DATABASE_URL', 'API_KEY', 'JWT_SECRET'] });
```
