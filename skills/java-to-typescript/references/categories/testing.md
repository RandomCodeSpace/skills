# Testing (JUnit / Mockito / AssertJ / Testcontainers → Vitest)

## Direct mapping table

| Java | Vitest | Notes |
|---|---|---|
| `@Test` | `it('description', () => {...})` | One `it` per behavior. |
| `@BeforeEach` | `beforeEach(() => {...})` | |
| `@AfterEach` | `afterEach(() => {...})` | |
| `@BeforeAll` | `beforeAll(() => {...})` | |
| `@ParameterizedTest` + `@ValueSource` | `it.each([...])('msg %s', (v) => {...})` | |
| `assertThat(x).isEqualTo(y)` | `expect(x).toEqual(y)` | AssertJ → expect chains. |
| `assertThrows(Foo.class, () -> ...)` | `expect(() => fn()).toThrow(Foo)` | Async: `await expect(fn()).rejects.toThrow(Foo)`. |
| `@Mock Foo foo;` | `const foo = vi.mocked<Foo>(...)` | Module-level: `vi.mock('./foo.js')`. |
| `when(foo.bar()).thenReturn(x)` | `vi.mocked(foo.bar).mockReturnValue(x)` | |
| `verify(foo).bar()` | `expect(foo.bar).toHaveBeenCalled()` | |
| `MockMvc.perform(get("/x"))` | `supertest(app).get('/x')` | No server boot needed. |
| `@Testcontainers` + `@Container PostgreSQLContainer` | `import { GenericContainer } from 'testcontainers';` in `beforeAll` | |

## File layout

```
src/services/user-service.ts
src/services/user-service.test.ts   # co-located unit test
tests/integration/users.test.ts     # integration tests (testcontainers)
```

## Unit test skeleton

```typescript
import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserService } from './user-service.js';

describe('UserService', () => {
  let repo: { findById: ReturnType<typeof vi.fn> };
  let svc: UserService;

  beforeEach(() => {
    repo = { findById: vi.fn() };
    svc = new UserService(repo as any);
  });

  it('returns the user when present', async () => {
    repo.findById.mockResolvedValue({ id: 1n, name: 'Ada' });
    expect(await svc.getUser(1n)).toEqual({ id: 1n, name: 'Ada' });
  });

  it('throws when missing', async () => {
    repo.findById.mockResolvedValue(undefined);
    await expect(svc.getUser(1n)).rejects.toThrow(/not found/);
  });
});
```

## Integration test skeleton (testcontainers)

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import supertest from 'supertest';

let pg: StartedTestContainer;
let pool: Pool;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  pg = await new GenericContainer('postgres:16')
    .withEnvironment({ POSTGRES_USER: 't', POSTGRES_PASSWORD: 't', POSTGRES_DB: 't' })
    .withExposedPorts(5432)
    .start();
  pool = new Pool({ host: pg.getHost(), port: pg.getMappedPort(5432), user: 't', password: 't', database: 't' });
  process.env.DATABASE_URL = `postgresql://t:t@${pg.getHost()}:${pg.getMappedPort(5432)}/t`;
  // run drizzle migrations against pool
  app = buildApp();
});

afterAll(async () => {
  await pool.end();
  await pg.stop();
});

describe('POST /users', () => {
  it('creates a user', async () => {
    const res = await supertest(app).post('/users').send({ name: 'Ada', email: 'ada@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });
});
```

## What does NOT translate

| Java | Why and what to do |
|---|---|
| `@SpringBootTest` (full context load) | Use `buildApp()` directly + supertest. No full-app boot needed. |
| `@MockBean` | `vi.mock` at module scope. |
| `@DirtiesContext` | Recreate state in `beforeEach`. |
| `@Transactional` on test | Use a transaction-rollback wrapper around each test, OR truncate tables in `beforeEach`. |
| TestNG `@Test(dataProvider = ...)` | `it.each([...])` |
