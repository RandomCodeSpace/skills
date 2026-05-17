# Node runtime reference

Default runtime. Use Node 20 LTS or later.

## Tooling

- **Compiler:** `tsc` for production builds (emits to `dist/`).
- **Dev runner:** `tsx` for running `.ts` directly (`tsx src/server.ts`).
- **Test runner:** `vitest` (configured in `vitest.config.ts`).
- **Process manager:** none in dev; in prod, whatever the user runs (PM2, systemd, Kubernetes).

## Module system

- `"type": "module"` in every `package.json`.
- `module: "NodeNext"` and `moduleResolution: "NodeNext"` in tsconfig.
- All relative imports MUST include the `.js` extension (even from `.ts` sources): `import { foo } from './foo.js'`.
- CJS interop via `esModuleInterop: true`. Avoid `require()` in new code.

## Startup convention

```typescript
// src/server.ts
import { buildApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

const app = buildApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'listening');
});

// Graceful shutdown
const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

## Things to know that catch Java devs out

- No thread pool. All I/O is async/event-loop driven. Don't introduce worker threads unless CPU-bound.
- No checked exceptions. The type system doesn't reflect what a function can throw.
- `process.env.X` is `string | undefined`. Always validate via zod at startup.
- Top-level `await` works in ESM modules but not in CJS.
- `package.json` `exports` field is significant — drizzle, pino, etc. use it for sub-paths.

## Air-gap considerations

- Use a proxied npm registry (Verdaccio, Artifactory, Nexus). Configure via `.npmrc`:

```
registry=https://npm.internal.example.com/
```

- Never commit a registry URL containing credentials. Inject via `NPM_CONFIG_REGISTRY` env if needed.
- Pre-cache critical packages: `undici`, `pino`, `zod`, `express`, `drizzle-orm`, `tsyringe`, `decimal.js`, `temporal-polyfill`.
