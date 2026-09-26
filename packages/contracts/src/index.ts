// @repro/contracts: the section 4 contracts from CLAUDE.md. Schemas are named `<Name>` and
// exported as values so code can call `Finding.parse()`, etc. Types are inferred from the schemas.
// TypeScript's type inference will derive the type from the schema value, so you can use both
// `Finding.parse()` (the value) and `const x: Finding = ...` (the inferred type).
export * from "./schemas.js";
export type { Executor, DetectorAdapter } from "./types.js";
