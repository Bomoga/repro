// @repro/api: the Control Plane API (Fastify + tRPC) and the Run Store behind it. Importing this
// module never opens a port or a database connection; src/main.ts is the server entrypoint.
export { buildApp, type BuildAppOptions } from "./app.ts";
export { appRouter, type AppRouter, type RunDetail, type RunSummary } from "./router.ts";
export type { Context } from "./trpc.ts";
export { checkHealth, type Health } from "./health.ts";
export { targetProblem } from "./targets.ts";
export { buildTrustReport, type TrustReport } from "./trust.ts";
export { buildReport, type FindingJourneyStatus, type ReportedStage, type RunReport } from "./report.ts";
export { recordPullRequestClosed, type PullRequestClosed, type PullRequestOutcome } from "./pull-requests.ts";
export { githubWebhook, validGitHubSignature } from "./github-webhook.ts";
export { PULL_REQUEST_MODES, pullRequestModeFromEnv, runtimeSettings, type PullRequestMode } from "./settings.ts";
export { googleSignIn, googleSignInStatus, isLoopbackUrl, type GoogleSignInStatus } from "./google-sign-in.ts";
export { demoRunRecords, importRunRecord, seedDemoData, type RunRecord, type SeedResult } from "./seed.ts";
export * from "./store/index.ts";
