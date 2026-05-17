# Vendored: fast-xml-parser

- **Upstream:** https://github.com/NaturalIntelligence/fast-xml-parser
- **Version vendored:** 4.5.0
- **License:** MIT (see `LICENSE` in this directory)
- **Why vendored:** the `java-to-typescript` skill must run in air-gapped
  environments. Vendoring avoids a runtime `npm` registry fetch.

## Layout

```
fast-xml-parser/
  LICENSE              # MIT, copied verbatim from upstream
  README.md            # this file
  index.js             # ESM shim that re-exports XMLParser/XMLValidator/XMLBuilder
  index.d.ts           # TypeScript types re-export
  src/                 # CommonJS source from upstream src/, minus v5/ and cli/
    package.json       # pins this subtree to "type": "commonjs"
    fxp.js             # upstream entry (referenced by upstream package.json `main`)
    fxp.d.ts           # upstream type declarations
    util.js
    validator.js
    ignoreAttributes.js
    xmlparser/
      XMLParser.js
      OptionsBuilder.js
      OrderedObjParser.js  # patched: `require("strnum")` -> relative path
      DocTypeReader.js
      node2json.js
      xmlNode.js
    xmlbuilder/
      json2xml.js
      orderedJs2Xml.js
  vendor/
    package.json       # pins this subtree to "type": "commonjs"
    strnum/            # upstream `strnum@1.1.2` (MIT) — required by OrderedObjParser
      LICENSE
      strnum.js
```

## Consumer usage

The outer `java-to-typescript` package is `"type": "module"`. Import the
vendored entry as ESM:

```ts
import { XMLParser } from './lib/fast-xml-parser/index.js';
```

The ESM `index.js` uses `createRequire` to load the underlying CommonJS
modules. The nested `src/package.json` and `vendor/package.json` pin
those subtrees to `"type": "commonjs"` so Node loads `.js` files there as
CJS even though the outer package is ESM.

## Files omitted vs. upstream

- `src/v5/**` — experimental v5 parser, not used by `XMLParser`.
- `src/cli/**` — `fxparser` CLI binary, not used by the skill.
- `CHANGELOG.md`, `README.md`, upstream `package.json` — not needed at runtime.
- Upstream `strnum` test file and README/CHANGELOG.

## Local modifications

- `src/xmlparser/OrderedObjParser.js`: replaced
  `require("strnum")` with `require("../../vendor/strnum/strnum.js")` so
  the parser resolves the vendored copy without any `node_modules` lookup.

## Update policy

To upgrade:

1. Re-run the steps in plan Task 8 with the new upstream version.
2. Re-verify the layout — `package.json.main`/`typings` and the internal
   `require` graph may shift between minor releases.
3. Re-apply the `strnum` path patch (or revise it if upstream changes
   that import).
4. Re-run the M0 eval suite to confirm parse stability against
   `evals/fixtures/spring-boot-users/java/`.
