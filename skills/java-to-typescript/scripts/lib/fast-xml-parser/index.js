// ESM shim over the vendored CommonJS fast-xml-parser 4.5.0 entry point.
// The upstream entry (`src/fxp.js`) is CJS. The `src/package.json` in this
// vendored copy pins that subtree to `type: commonjs` so Node loads it
// correctly even though the outer `java-to-typescript` package is ESM.
//
// We use `createRequire` rather than a bare `import` so Node's static
// named-export detection does not need to introspect the CJS module shape.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fxp = require('./src/fxp.js');

export const XMLParser = fxp.XMLParser;
export const XMLValidator = fxp.XMLValidator;
export const XMLBuilder = fxp.XMLBuilder;

export default fxp;
