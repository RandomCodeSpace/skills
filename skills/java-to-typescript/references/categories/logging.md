# Logging (SLF4J + Logback → pino)

## Why pino

Structured by default, fast, MIT, no native deps, supports per-module child loggers cheaply. Configurable transports for files / syslog / OTel without a separate config file.

## Setup

```typescript
// src/logger.ts (one per module)
import pino from 'pino';
import { config } from './config.js';

export const baseLogger = pino({
  level: config.LOG_LEVEL,
  base: { service: config.SERVICE_NAME, env: config.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const logger = baseLogger; // for the module entry
```

In each file inside the module:

```typescript
import { baseLogger } from '../logger.js';
const log = baseLogger.child({ module: 'user-service' });

log.info({ userId: id }, 'fetched user');
log.warn({ err }, 'retrying upstream');
```

## SLF4J → pino mapping

| SLF4J | pino |
|---|---|
| `LoggerFactory.getLogger(Foo.class)` | `baseLogger.child({ module: 'Foo' })` |
| `log.info("user {} fetched", id)` | `log.info({ userId: id }, 'user fetched')` — structured fields, not interpolated message |
| `log.error("failed", e)` | `log.error({ err: e }, 'failed')` — pino serializes Error via the `err` key automatically |
| `MDC.put("requestId", x)` | Bind via `child({ requestId: x })` or `AsyncLocalStorage` (see below) |
| `@Slf4j` on a class | `import { baseLogger }; const log = baseLogger.child({ module: 'X' })` |

## Request-scoped fields (MDC equivalent)

Use `AsyncLocalStorage`:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<{ requestId: string; userId?: string }>();

// middleware
app.use((req, _res, next) => {
  const ctx = { requestId: crypto.randomUUID() };
  requestContext.run(ctx, () => next());
});

// usage in any module
const ctx = requestContext.getStore();
log.info({ ...ctx, op: 'createUser' }, 'creating');
```

## What NOT to do

- No `console.log`. Ever. The lint rule `no-console` should be enabled.
- No string interpolation in messages — pino keeps structured fields searchable.
- No global logger that swallows context — always use a child with module/route context.
