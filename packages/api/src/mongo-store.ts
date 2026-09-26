import mongoose, { Schema } from "mongoose";
import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import { InvalidPatchDecisionError, PatchNotFoundError, type RunQuery, type RunStore } from "./store.ts";

// Schemas mirror @repro/contracts field-for-field; this file only owns persistence, never
// validation (the API layer parses with the Zod contracts before/after touching Mongo).
const runSchema = new Schema<Run>(
  {
    id: { type: String, required: true, unique: true },
    trigger: { type: String, required: true },
    target: {
      kind: { type: String, required: true },
      ref: { type: String, required: true },
    },
    stage: { type: String, required: true },
    status: { type: String, required: true },
    startedAt: { type: String, required: true },
    logRef: { type: String, required: true },
  },
  { collection: "runs", versionKey: false },
);

const findingSchema = new Schema<Finding & { runId: string }>(
  {
    id: { type: String, required: true, unique: true },
    runId: { type: String, required: true, index: true },
    detectorId: String,
    ruleId: String,
    severity: String,
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
  },
  { collection: "findings", versionKey: false },
);

const diagnosisSchema = new Schema<Diagnosis & { runId: string }>(
  {
    id: { type: String, required: true, unique: true },
    runId: { type: String, required: true, index: true },
    findingIds: [String],
    rootCause: String,
    proposedStrategy: String,
    riskNotes: String,
    model: String,
    createdAt: String,
  },
  { collection: "diagnoses", versionKey: false },
);

const patchSchema = new Schema<Patch & { runId: string }>(
  {
    id: { type: String, required: true, unique: true },
    runId: { type: String, required: true, index: true },
    diagnosisId: String,
    diff: String,
    filesChanged: [String],
    testsPassed: Boolean,
    originalFindingReproduces: Boolean,
    reproductionOutputAfter: String,
    regressionFindings: [Schema.Types.Mixed],
    challengerVerdict: String,
    challengerNotes: String,
    status: String,
    prUrl: String,
  },
  { collection: "patches", versionKey: false },
);

const RunModel = mongoose.model("Run", runSchema);
const FindingModel = mongoose.model("Finding", findingSchema);
const DiagnosisModel = mongoose.model("Diagnosis", diagnosisSchema);
const PatchModel = mongoose.model("Patch", patchSchema);

function strip<T extends { _id?: unknown; __v?: unknown; runId?: unknown }>(doc: T): Omit<T, "_id" | "__v" | "runId"> {
  const { _id, __v, runId, ...rest } = doc as Record<string, unknown>;
  return rest as Omit<T, "_id" | "__v" | "runId">;
}

export async function connectMongoStore(uri: string): Promise<RunStore> {
  await mongoose.connect(uri);
  return new MongoRunStore();
}

export class MongoRunStore implements RunStore {
  async createRun(input: { target: Run["target"]; trigger: Run["trigger"] }): Promise<Run> {
    const run: Run = {
      id: `run_${crypto.randomUUID()}`,
      trigger: input.trigger,
      target: input.target,
      stage: "ingest",
      status: "queued",
      startedAt: new Date().toISOString(),
      logRef: "",
    };
    await RunModel.create(run);
    return run;
  }

  async listRuns(query: RunQuery = {}): Promise<Run[]> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    const docs = await RunModel.find(filter)
      .sort({ startedAt: -1 })
      .limit(query.limit ?? 50)
      .lean();
    return docs.map((d) => strip(d) as Run);
  }

  async getRun(runId: string): Promise<Run | null> {
    const doc = await RunModel.findOne({ id: runId }).lean();
    return doc ? (strip(doc) as Run) : null;
  }

  async listFindings(runId: string): Promise<Finding[]> {
    const docs = await FindingModel.find({ runId }).lean();
    return docs.map((d) => strip(d) as Finding);
  }

  async listDiagnoses(runId: string): Promise<Diagnosis[]> {
    const docs = await DiagnosisModel.find({ runId }).lean();
    return docs.map((d) => strip(d) as Diagnosis);
  }

  async listPatches(runId: string): Promise<Patch[]> {
    const docs = await PatchModel.find({ runId }).lean();
    return docs.map((d) => strip(d) as Patch);
  }

  async getPatch(patchId: string): Promise<Patch | null> {
    const doc = await PatchModel.findOne({ id: patchId }).lean();
    return doc ? (strip(doc) as Patch) : null;
  }

  async setPatchDecision(patchId: string, decision: "merge" | "reject"): Promise<Patch> {
    const doc = await PatchModel.findOne({ id: patchId });
    if (!doc) throw new PatchNotFoundError(patchId);
    if (doc.get("status") !== "verified") throw new InvalidPatchDecisionError(patchId, doc.get("status"));
    doc.set("status", decision === "merge" ? "merged" : "rejected");
    await doc.save();
    return strip(doc.toObject()) as Patch;
  }
}
