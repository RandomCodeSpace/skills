# Build layout (Maven/Gradle multi-module → npm workspaces)

## Default mapping

| Maven / Gradle | TS workspace |
|---|---|
| Parent `pom.xml` / `settings.gradle[.kts]` | Root `package.json` with `"workspaces": [...]` |
| `<module>foo</module>` / `include 'foo'` | `foo/package.json` |
| `<dependency>` on a sibling module | npm workspace dependency: `"@org/foo": "*"` |
| Maven `${revision}` placeholder | Per-workspace `version` field; or root version + Changesets |
| `mvn package` | `npm run build --workspaces --if-present` |
| `mvn test` | `npm run test --workspaces --if-present` |

## Root `package.json` skeleton (npm default)

```json
{
  "name": "@example/services",
  "private": true,
  "workspaces": ["api", "core"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "^2",
    "tsx": "^4"
  }
}
```

## Alternate package managers (opt-in)

### pnpm

Root `pnpm-workspace.yaml`:

```yaml
packages:
  - 'api'
  - 'core'
```

Remove `workspaces` from root `package.json`; pnpm uses the YAML file.

### yarn

Same as npm — yarn honors the `workspaces` array. `.yarnrc.yml` for v4 Berry.

### bun

`package.json` `workspaces` array works. Use `bun install`, `bun test` (or keep vitest).

## Dependency-order build

`tsc -b` (build mode) walks the workspace project references. Add to each module's `tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "references": [{ "path": "../core" }],
  "compilerOptions": { "composite": true }
}
```

Then `tsc -b` from the root builds in topological order.

## Don't flatten

The temptation: collapse `api/core/users` into one big `src/`. Resist. The module boundaries from Maven/Gradle are signal — they encode intent. Preserve them as workspace boundaries.
