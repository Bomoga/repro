// Mongoose schemas for the Run Store. Each collection holds one section 4 contract per document,
// field for field, plus the one storage-only field `runId` that ties a Finding, Diagnosis, Patch,
// or log entry to its Run. The Zod contracts in @repro/contracts are the validators: every write
// through this package parses with them first, and every read parses again on the way out. These
// schemas only own storage: field types, enum values (taken straight from the contracts, so they
// can't drift), and indexes.
//
// `strict: "throw"` is the drift alarm. If a contract gains a field and this file doesn't, the
// write fails loudly instead of Mongo silently dropping the field. test/models.test.ts checks the
// same thing without a database: every contract key has a path here, and nothing else does.
//
// `_id` is Mongo's internal key and never leaves this package; `id` is the contract's own string
// ID, generated upstream, and carries the unique index.
import { Schema, type Connection, type Model, type SchemaDefinition, type SchemaOptions } from "mongoose";
import { ENUMS, type Diagnosis, type Finding, type Patch, type Run } from "./contracts.js";

export const COLLECTIONS = {
  runs: "runs",
  findings: "findings",
  diagnoses: "diagnoses",
  patches: "patches",
  runLogs: "run_logs",
} as const;

/** A contract object as stored: the contract's fields plus the Run it belongs to. */
export type Stored<T> = T & { runId: string };

/** One retained prompt or tool-call record (section 9). `entry` is whatever the writer logged. */
export interface RunLogEntry {
  runId: string;
  at: string;
  kind: string;
  entry: unknown;
}

// No version key, no `id` virtual (the contracts own a real `id` field), no silently dropped fields.
const COMMON = { versionKey: false, id: false, strict: "throw", strictQuery: "throw" } as const;

// Schemas are built untyped on purpose. Mongoose's inference over a literal definition is slow
// enough to exhaust tsc's heap here, and it would only duplicate the contract types: every read
// is parsed by the Zod contract, which is where the real types come from.
type Raw = Record<string, unknown>;
function defineSchema(definition: SchemaDefinition, options: SchemaOptions): Schema<Raw> {
  return new Schema<Raw>(definition as SchemaDefinition<Raw>, options as SchemaOptions<Raw>);
}

// Finding's fields, shared by the findings collection and Patch.regressionFindings, which embeds
// full Finding objects (section 4).
const findingFields: SchemaDefinition = {
  id: { type: String, required: true },
  detectorId: String,
  ruleId: String,
  severity: { type: String, enum: ENUMS.severity },
  category: String,
  file: String,
  lineStart: Number,
  lineEnd: Number,
  message: String,
  evidence: String,
  reproducible: Boolean,
  reproductionCommand: String,
  reproductionOutput: String,
  createdAt: String,
};

export const runSchema = defineSchema(
  {
    id: { type: String, required: true },
    trigger: { type: String, enum: ENUMS.runTrigger },
    target: {
      kind: { type: String, enum: ENUMS.runTargetKind },
      ref: String,
    },
    stage: { type: String, enum: ENUMS.runStage },
    status: { type: String, enum: ENUMS.runStatus },
    startedAt: String,
    logRef: String,
  },
  { ...COMMON, collection: COLLECTIONS.runs },
);
runSchema.index({ id: 1 }, { unique: true });
// Runs by status, newest first (dashboard, `repro status`); oldest queued first (orchestrator's claim).
runSchema.index({ status: 1, startedAt: -1 });
// Every run, newest first.
runSchema.index({ startedAt: -1 });
// Runs in a given stage: "what is in repair right now", and resuming after an orchestrator restart.
runSchema.index({ stage: 1, status: 1 });

export const findingSchema = defineSchema(
  { ...findingFields, runId: { type: String, required: true } },
  { ...COMMON, collection: COLLECTIONS.findings },
);
findingSchema.index({ id: 1 }, { unique: true });
// A run's findings in file order; also serves any query filtered on runId alone.
findingSchema.index({ runId: 1, file: 1, lineStart: 1 });
// Confirmed vs. unconfirmed: the count that collapses in demo beat 2, and what Diagnose may repair.
findingSchema.index({ runId: 1, reproducible: 1 });
// Findings by detector: the Trust Report reads privacy-patterns and gitleaks.
findingSchema.index({ runId: 1, detectorId: 1 });

const embeddedFindingSchema = defineSchema(findingFields, { ...COMMON, _id: false });

export const diagnosisSchema = defineSchema(
  {
    id: { type: String, required: true },
    runId: { type: String, required: true },
    findingIds: [String],
    rootCause: String,
    proposedStrategy: String,
    riskNotes: String,
    model: String,
    createdAt: String,
  },
  { ...COMMON, collection: COLLECTIONS.diagnoses },
);
diagnosisSchema.index({ id: 1 }, { unique: true });
diagnosisSchema.index({ runId: 1, createdAt: 1 });
// Multikey: which Diagnosis cites a given Finding (Trust Report links, PR body).
diagnosisSchema.index({ findingIds: 1 });

export const patchSchema = defineSchema(
  {
    id: { type: String, required: true },
    runId: { type: String, required: true },
    diagnosisId: String,
    diff: String,
    filesChanged: [String],
    testsPassed: Boolean,
    originalFindingReproduces: Boolean,
    reproductionOutputAfter: String,
    regressionFindings: [embeddedFindingSchema],
    challengerVerdict: { type: String, enum: ENUMS.challengerVerdict },
    challengerNotes: String,
    status: { type: String, enum: ENUMS.patchStatus },
    prUrl: String,
  },
  { ...COMMON, collection: COLLECTIONS.patches },
);
patchSchema.index({ id: 1 }, { unique: true });
// A run's patches, optionally by status (the verified one that becomes a PR).
patchSchema.index({ runId: 1, status: 1 });
// Attempts per Diagnosis: section 5 caps them at two.
patchSchema.index({ diagnosisId: 1 });
// Across runs by status, newest first: every verified patch still waiting on a human merge.
patchSchema.index({ status: 1, _id: -1 });

export const runLogSchema = defineSchema(
  {
    runId: { type: String, required: true },
    at: String,
    kind: String,
    entry: Schema.Types.Mixed,
  },
  { ...COMMON, collection: COLLECTIONS.runLogs },
);
// One run's log in write order (`_id` is monotonic per writer).
runLogSchema.index({ runId: 1, _id: 1 });

export interface StoreModels {
  Run: Model<Run>;
  Finding: Model<Stored<Finding>>;
  Diagnosis: Model<Stored<Diagnosis>>;
  Patch: Model<Stored<Patch>>;
  RunLog: Model<RunLogEntry>;
}

/** Registers the models on one connection, reusing any already registered there. Models are
 *  per-connection, never on mongoose's global default, so this package can't collide with another
 *  package that registers its own "Run" model. */
export function bindModels(connection: Connection): StoreModels {
  const bind = <T>(name: string, schema: Schema<Raw>): Model<T> =>
    (connection.models[name] ?? connection.model(name, schema)) as unknown as Model<T>;
  return {
    Run: bind<Run>("Run", runSchema),
    Finding: bind<Stored<Finding>>("Finding", findingSchema),
    Diagnosis: bind<Stored<Diagnosis>>("Diagnosis", diagnosisSchema),
    Patch: bind<Stored<Patch>>("Patch", patchSchema),
    RunLog: bind<RunLogEntry>("RunLog", runLogSchema),
  };
}
