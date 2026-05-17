# Type fidelity policy

Hybrid: idiomatic TypeScript by default, high-fidelity escape for known-risky types. Deviations from this table require a one-line entry in the migration's `port-log.md` explaining why.

## Per-type table

| Java type | Idiomatic default | High-fidelity escape | Trigger |
|---|---|---|---|
| `Optional<T>` | `T \| undefined` | `Option<T>` from `@mobily/ts-belt` | user opts module in |
| `@Nullable T` | `T \| null` | same | always (consistent with Java intent) |
| `BigDecimal` | `Decimal` from `decimal.js` | same | **always** |
| `BigInteger` | `bigint` | same | always |
| `long` (non-ID) | `number` | `bigint` | range can exceed `Number.MAX_SAFE_INTEGER` |
| `Long` used as entity ID | `bigint` serialized as string on the wire | same | **always** |
| `Instant` | `Date` | same | — |
| `LocalDate` / `LocalDateTime` / `ZonedDateTime` | `Temporal.*` via `temporal-polyfill` | same | **always** |
| `UUID` | branded `string` (`type UUID = string & { readonly __brand: 'UUID' }`) | same | always |
| `Stream<T>` | `T[]` | `AsyncIterable<T>` | genuinely lazy / paginated |
| `Collection<T>` / `List<T>` | `T[]` | `readonly T[]` | exposed on public DTO |
| `Map<String, V>` | `Record<string, V>` | `Map<string, V>` | iteration order / non-string keys |
| `Set<T>` | `Set<T>` | same | — |
| `enum` | TS `enum` (narrow ordinals), const-union (string values) | discriminated union | enum carries methods |
| `record Foo` | `interface Foo` (readonly fields) | `class Foo` w/ frozen ctor | `instanceof` matters |
| `sealed interface` | discriminated union with `kind` tag | same | always |
| Checked exception on public API | tagged-union `Result<T, E>` (hand-rolled) | same | **always** for public API |
| Unchecked exception (internal) | `throw` | same | — |
| Lombok `@Data` | plain class with public fields | class + structural equality | used in `Set`/`Map` keys |
| Generic bound `<T extends X>` | preserve as TS constraint | same | always |
| Wildcards (`? extends T` / `? super T`) | relax to invariant; flag in `port-log.md` | variance helper type | API depends on variance |
| `equals` / `hashCode` | drop unless used | implement `equals(other)` + structural hash | actually used in collections |
| `Comparable<T>` | export `compare: (a, b) => number` | same | always |

## High-fidelity sketches

### `Result<T, E>` (replaces checked exceptions on public APIs)

```typescript
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

### Branded UUID

```typescript
declare const __brand: unique symbol;
export type UUID = string & { readonly [__brand]: 'UUID' };
export const asUuid = (s: string): UUID => s as UUID; // validate caller-side
```

### bigint IDs on the wire

JSON.stringify cannot serialize bigint. Convert to string at the boundary:

```typescript
const responseBody = { id: user.id.toString(), name: user.name };
```

Document the format in OpenAPI as `string` with pattern `^-?\d+$`.

## tsconfig (non-negotiable)

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": false
  }
}
```

`experimentalDecorators` is required for tsyringe and class-transformer. Plan the move to Stage 3 decorators when those libraries support them.

## Non-negotiable patterns

- One handler per file. `@RestController` with N methods → N TS files under `routes/`.
- DTO ≡ zod schema. No interfaces on HTTP boundaries without a schema.
- Repository ≡ Drizzle query module. No faked JPA repository interfaces.
- Config ≡ zod-validated env at startup. No scattered `process.env.FOO`.
- Logger ≡ module-scoped pino child. No `console.log`.
- Errors ≡ subclasses of a per-module base class. HTTP mapping via a single middleware.
