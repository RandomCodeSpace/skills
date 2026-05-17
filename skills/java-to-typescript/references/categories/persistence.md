# Persistence (JPA / Hibernate → Drizzle)

## Mental-model shift

JPA is a session-aware ORM with lazy loading, cascades, and dirty-checking. Drizzle is a typed query builder. The shift is from "save an entity graph" to "execute explicit queries". Encode all joins, transactions, and cascade behavior in a query module — don't try to recreate JPA semantics.

## Entity → Drizzle table

JPA:

```java
@Entity @Table(name = "users")
public class User {
  @Id @GeneratedValue Long id;
  @Column(nullable = false) String name;
  @Column(precision = 19, scale = 4) BigDecimal balance;
  @Column(name = "created_at") Instant createdAt;
}
```

Drizzle:

```typescript
import { pgTable, bigserial, text, numeric, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  name: text('name').notNull(),
  balance: numeric('balance', { precision: 19, scale: 4 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

Per type-fidelity policy: `Long` ID → `bigint` (drizzle's `bigserial { mode: 'bigint' }`); `BigDecimal` → numeric column → read as `string`, wrap in `Decimal` at the service boundary.

## Repository → query module

JPA `interface UserRepository extends JpaRepository<User, Long>` → a TS module of named functions:

```typescript
import { eq } from 'drizzle-orm';
import { container } from 'tsyringe';
import { users } from '../db/schema.js';

export function makeUserRepo(db: Database) {
  return {
    async findById(id: bigint): Promise<User | undefined> {
      const [row] = await db.select().from(users).where(eq(users.id, id));
      return row;
    },
    async insert(u: NewUser): Promise<User> {
      const [row] = await db.insert(users).values(u).returning();
      return row!;
    },
  };
}
```

No abstract repository interface. No JpaRepository hierarchy. Plain functions, returned from a factory, registered in tsyringe.

## Transactions

JPA `@Transactional` → wrap the query module call in `db.transaction`:

```typescript
await db.transaction(async (tx) => {
  const repo = makeUserRepo(tx);
  await repo.insert(...);
  // multiple ops, all in one tx
});
```

## Lazy loading

There is no equivalent. Make joins explicit:

```typescript
db.select().from(users).leftJoin(orders, eq(users.id, orders.userId));
```

If the Java code relies heavily on lazy loading across boundaries, refactor to fetch-and-return; do not introduce a proxy layer.

## Migrations

JPA + Flyway/Liquibase → drizzle-kit:

```
npx drizzle-kit generate     # generate SQL from schema diff
npx drizzle-kit migrate      # apply
```

Migration files are SQL; commit them to the repo. Drizzle-kit has no Java equivalent of Liquibase changesets — keep migrations linear.
