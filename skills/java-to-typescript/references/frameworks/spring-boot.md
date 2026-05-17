# Spring Boot porting reference

This reference covers translation patterns from Spring Boot to TypeScript (default target: Express + tsyringe + zod, runtime Node). For specific TS-framework idioms, consult the matching file under `targets/`.

## Annotation → TS translation table

| Spring Boot | TypeScript equivalent | Notes |
|---|---|---|
| `@SpringBootApplication` | An `app.ts` that wires DI container + middleware + routes and calls `app.listen()` | No auto-config; everything explicit. |
| `@RestController` | A module of route handler functions registered with the Express router | One handler per file. |
| `@RequestMapping` / `@GetMapping("/users/{id}")` | `router.get('/users/:id', handler)` | URL params come via `req.params`. |
| `@RequestBody Foo dto` | `const dto = FooSchema.parse(req.body)` | DTO ≡ zod schema. |
| `@PathVariable` / `@RequestParam` | `req.params.id` / `req.query.q` | Type via zod schema in route input. |
| `@Service` / `@Component` / `@Repository` | `@injectable()` class registered in tsyringe container | Constructor injection only. |
| `@Autowired` (constructor) | `constructor(@inject('Foo') private foo: Foo)` | Field injection not supported. |
| `@Configuration` + `@Bean` | tsyringe `container.register('Token', { useFactory })` calls in `wiring.ts` | One wiring file per module. |
| `@ConfigurationProperties("app")` | `const config = AppConfigSchema.parse(process.env)` in `config.ts` | See `categories/config.md`. |
| `@Transactional` | Wrap query module calls in `db.transaction(async (tx) => ...)` | drizzle exposes `db.transaction`. |
| `@ExceptionHandler` | Single error-handling middleware mapping per-module Error subclasses → HTTP status | See `categories/di.md`. |
| `@Valid` on `@RequestBody` | `FooSchema.parse()` (throws on invalid) | Wrap in middleware to translate ZodError → 400. |
| `ResponseEntity<T>` | `res.status(s).json(body)` | Don't introduce a `ResponseEntity` shim. |
| `@PreAuthorize("hasRole('ADMIN')")` | per-route `requireRole('ADMIN')` middleware | Method-level auth → explicit guard call. |
| Spring DI `@Qualifier("name")` | tsyringe string token: `@inject('name')` | Use injection tokens consistently. |

## Layered structure mapping

| Spring Boot package | TS module path |
|---|---|
| `com.example.controller` | `src/routes/` (one file per handler) |
| `com.example.service` | `src/services/` (one class per service) |
| `com.example.repository` | `src/repos/` (one module per repository) |
| `com.example.dto` | `src/schemas/` (zod schemas, types via z.infer) |
| `com.example.entity` | `src/db/schema.ts` (drizzle tables) |
| `com.example.config` | `src/config.ts` (single zod-parsed env object) |

## Things explicitly to skip

- `BeanPostProcessor`, `@PostConstruct` chains, AOP aspects — wire explicitly in `wiring.ts`.
- `ApplicationContext` global lookups — replace with explicit `container.resolve`.
- Auto-discovery via classpath scanning — register beans in `wiring.ts` by hand.
- `@EntityListeners`, `@PrePersist` callbacks — encode in the query module, not in entity decorators.
- Spring Profiles — use environment variables + a single `config.ts`.
