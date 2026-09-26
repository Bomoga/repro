// @repro/api: the Control Plane API (Fastify + tRPC) and the Run Store behind it. Importing this
// module never opens a port or a database connection; src/main.ts is the server entrypoint.
export { buildApp, type BuildAppOptions } from "./app.ts";
export { appRouter, type AppRouter, type RunDetail, type RunSummary } from "./router.ts";
export type { Context } from "./trpc.ts";
export { checkHealth, type Health } from "./health.ts";
export { targetProblem } from "./targets.ts";
export { buildTrustReport, type TrustReport } from "./trust.ts";
export { demoRunRecords, importRunRecord, seedDemoData, type RunRecord, type SeedResult } from "./seed.ts";
export * from "./store/index.ts";
