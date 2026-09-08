// @pokernight/engine reads `globalThis.crypto` (it typechecks against @types/node). workers-types
// declares `crypto` as a block-scoped const, which TypeScript does not expose on `typeof globalThis`.
// This var declaration makes the engine source compile inside the Worker without pulling in DOM or
// Node globals. It is a .d.ts so skipLibCheck applies; at runtime workerd provides the real global.
declare var crypto: Crypto;
