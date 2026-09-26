// @repro/store: the Run Store (CLAUDE.md sections 3 and 10) on MongoDB Atlas. Mongoose schemas for
// the runs, findings, diagnoses, patches, and run_logs collections, the connection to the shared
// cluster, and query helpers that validate every write against @repro/contracts.
export {
  connectionHint,
  databaseFromUri,
  DEFAULT_DB_NAME,
  MissingMongoUriError,
  openConnection,
  redactMongoUri,
  resolveConnectionSettings,
  StoreConnectionError,
  type ConnectionSettings,
  type StoreConnectOptions,
} from "./connection.js";
export * from "./errors.js";
export {
  bindModels,
  COLLECTIONS,
  diagnosisSchema,
  findingSchema,
  patchSchema,
  runLogSchema,
  runSchema,
  type RunLogEntry,
  type Stored,
  type StoreModels,
} from "./models.js";
export { diagnosisQueries, type DiagnosisQueries } from "./queries/diagnoses.js";
export { findingQueries, type FindingCounts, type FindingQueries, type ListFindingsQuery } from "./queries/findings.js";
export { runLogQueries, type LogRecord, type RunLogQueries, type RunLogWriter } from "./queries/logs.js";
export {
  gateFailures,
  PATCH_TRANSITIONS,
  patchQueries,
  type ListPatchesQuery,
  type PatchQueries,
  type PatchVerification,
} from "./queries/patches.js";
export {
  ACTIVE_RUN_STATUSES,
  logRefFor,
  runQueries,
  type ActiveRunStatus,
  type CreateRunInput,
  type ListRunsQuery,
  type RunQueries,
} from "./queries/runs.js";
export type { WriteSummary } from "./queries/shared.js";
export { connectStore, createRunStore, type RunStore } from "./store.js";
