// Type re-exports for the vendored fast-xml-parser 4.5.0 ESM shim.
// See ./src/fxp.d.ts for the upstream type declarations.

export { XMLParser, XMLValidator, XMLBuilder } from './src/fxp.js';

declare const _default: {
  XMLParser: typeof import('./src/fxp.js').XMLParser;
  XMLValidator: typeof import('./src/fxp.js').XMLValidator;
  XMLBuilder: typeof import('./src/fxp.js').XMLBuilder;
};

export default _default;
