# Validation (Bean Validation → Zod)

Hand-translate Bean Validation annotations to zod schemas. No codemod, no auto-generator.

## Annotation → zod mapping table

| Bean Validation | zod |
|---|---|
| `@NotNull` | (default — non-optional fields are non-null) |
| `@NotBlank` | `z.string().min(1).regex(/\S/)` |
| `@NotEmpty` on `String` | `z.string().min(1)` |
| `@NotEmpty` on `List<T>` | `z.array(T).min(1)` |
| `@Size(min = m, max = M)` on `String` | `z.string().min(m).max(M)` |
| `@Size(min, max)` on `List<T>` | `z.array(T).min(m).max(M)` |
| `@Min(n)` / `@Max(n)` | `z.number().min(n)` / `.max(n)` |
| `@DecimalMin("0.01")` | `z.string().refine((s) => new Decimal(s).gte('0.01'))` (preserve BigDecimal precision via Decimal.js) |
| `@Email` | `z.string().email()` |
| `@Pattern(regexp)` | `z.string().regex(/.../)` |
| `@Past` / `@Future` (`Instant`) | `.refine((d) => d < new Date())` / `> new Date()` |
| `@Valid` on nested | nested schema inside `z.object` |
| `@AssertTrue` on method | `.refine((obj) => predicate(obj), { message })` |

## Per-DTO file structure

```typescript
// src/schemas/create-user.ts
import { z } from 'zod';

export const CreateUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  balance: z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'must be decimal'),
}).strict(); // strict() rejects unknown keys, matching Jackson FAIL_ON_UNKNOWN_PROPERTIES=true

export type CreateUser = z.infer<typeof CreateUserSchema>;
```

Validate at every HTTP boundary:

```typescript
const dto = CreateUserSchema.parse(req.body);
```

## Validation groups

Java validation groups (Default, OnCreate, OnUpdate) → distinct zod schemas per group. Do NOT try to share schemas via discriminated unions unless the API itself is genuinely polymorphic.

```typescript
export const CreateUserSchema = z.object({ name: z.string(), email: z.string().email() });
export const UpdateUserSchema = z.object({ name: z.string().optional(), email: z.string().email().optional() });
```

## Error mapping

Map `ZodError` to HTTP 400 in the error-handling middleware (see `targets/express.md`). Don't catch and re-throw at the handler.
