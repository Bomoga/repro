import mongoose, { Schema, type Connection, type Model } from "mongoose";
import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import {
  applyRunUpdate,
  assertDiagnosesInsertable,
  assertFindingsInsertable,
  assertPatchWritable,
  assertReproductionRecordable,
  assertRunConsistent,
  buildNewRun,
  decidedPatch,
  emptyCounts,
  isVerifiedStatus,
  notFound,
  reproducedFinding,
} from "./invariants.ts";
import {
  DEFAULT_RUN_LIMIT,
  StoreError,
  type FindingQuery,
  type NewRun,
  type PatchDecision,
  type RunCounts,
  type RunQuery,
  type RunStore,
  type RunUpdate,
} from "./types.ts";

// MongoDB Atlas collections for Runs, Findings, Diagnoses, and Patches (section 10). Documents are
// the section 4 contracts field for field, plus `runId` on Findings, Diagnoses, and Patches to say
// which Run they belong to. Mongo's own `_id` and that `runId` are storage details: every read
// projects them away, so what comes back is exactly a contract object.
//
// Deliberately flat and aggregation-free (section 13's Mongoose risk): plain finds, inserts, and
// conditional single-document updates. The conditional updates make each state transition atomic,
// so two writers racing on the same Run or Patch can't both win.

const findingFields = {
  id: { type: String, required: true },
  detectorId: String,
  ruleId: String,
  severity: String,
  category: String,
  file: String,
  lineStart: Number,
  lineEnd: Number,
  message: String,
  evidence: String,
  reproducible: { type: Boolean, required: true },
  reproductionCommand: String,
  reproductionOutput: String,
  createdAt: String,
};

const schemaOptions = { versionKey: false, id: false } as const;

const runSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    trigger: String,
    target: { kind: String, ref: String },
    stage: { type: String, required: true },
    status: { type: String, required: true, index: true },
    startedAt: { type: String, required: true, index: true },
    logRef: String,
  },
  { ...schemaOptions, collection: "runs" },
);

const findingSchema = new Schema(
  {
    ...findingFields,
    id: { type: String, required: true, unique: true },
    runId: { type: String, required: true, index: true },
  },
  { ...schemaOptions, collection: "findings" },
);

const diagnosisSchema = new Schema(
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
  { ...schemaOptions, collection: "diagnoses" },
);

const patchSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    runId: { type: String, required: true, index: true },
    diagnosisId: { type: String, required: true },
    diff: String,
    filesChanged: [String],
    testsPassed: Boolean,
    originalFindingReproduces: Boolean,
    reproductionOutputAfter: String,
    regressionFindings: [new Schema(findingFields, { ...schemaOptions, _id: false })],
    challengerVerdict: String,
    challengerNotes: String,
    status: { type: String, required: true },
    prUrl: String,
  },
  { ...schemaOptions, collection: "patches" },
);

const RUN_PROJECTION = { _id: 0 } as const;
const CHILD_PROJECTION = { _id: 0, runId: 0 } as const;

function buildModels(conn: Connection) {
  return {
    runs: conn.model("Run", runSchema),
    findings: conn.model("Finding", findingSchema),
    diagnoses: conn.model("Diagnosis", diagnosisSchema),
    patches: conn.model("Patch", patchSchema),
  };
}

type Models = ReturnType<typeof buildModels>;

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

export interface MongoRunStoreOptions {
  /** Database name; defaults to the one in the connection string. */
  dbName?: string;
  serverSelectionTimeoutMS?: number;
}

export class MongoRunStore implements RunStore {
  readonly kind = "mongo" as const;

  private readonly conn: Connection;
  private readonly models: Models;

  private constructor(conn: Connection, models: Models) {
    this.conn = conn;
    this.models = models;
  }

  /** Connects on a dedicated connection (not mongoose's global one) and builds indexes. */
  static async connect(uri: string, options: MongoRunStoreOptions = {}): Promise<MongoRunStore> {
    const conn = mongoose.createConnection(uri, {
      dbName: options.dbName,
      serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 10_000,
    });
    try {
      await conn.asPromise();
      const models = buildModels(conn);
      await Promise.all(Object.values(models).map((model) => model.init()));
      return new MongoRunStore(conn, models);
    } catch (error) {
      await conn.close().catch(() => {});
      throw error;
    }
  }

  async listRuns(query: RunQuery = {}): Promise<Run[]> {
    const limit = query.limit ?? DEFAULT_RUN_LIMIT;
    if (limit <= 0) return []; // Mongo reads limit(0) as "no limit"
    return this.models.runs
      .find(query.status ? { status: query.status } : {}, RUN_PROJECTION)
      .sort({ startedAt: -1, id: 1 })
      .skip(query.offset ?? 0)
      .limit(limit)
      .lean<Run[]>();
  }

  async getRun(runId: string): Promise<Run | null> {
    return this.models.runs.findOne({ id: runId }, RUN_PROJECTION).lean<Run>();
  }

  async countRuns(runIds: string[]): Promise<Record<string, RunCounts>> {
    const counts: Record<string, RunCounts> = {};
    for (const runId of runIds) counts[runId] = emptyCounts();
    if (runIds.length === 0) return counts;

    const inRuns = { runId: { $in: runIds } };
    const [findings, diagnoses, patches] = await Promise.all([
      this.models.findings.find(inRuns, { _id: 0, runId: 1, reproducible: 1 }).lean<{ runId: string; reproducible: boolean }[]>(),
      this.models.diagnoses.find(inRuns, { _id: 0, runId: 1 }).lean<{ runId: string }[]>(),
      this.models.patches.find(inRuns, { _id: 0, runId: 1, status: 1 }).lean<{ runId: string; status: Patch["status"] }[]>(),
    ]);
    for (const f of findings) {
      counts[f.runId]!.findings += 1;
      if (f.reproducible) counts[f.runId]!.reproducible += 1;
    }
    for (const d of diagnoses) counts[d.runId]!.diagnoses += 1;
    for (const p of patches) {
      counts[p.runId]!.patches += 1;
      if (isVerifiedStatus(p.status)) counts[p.runId]!.verifiedPatches += 1;
    }
    return counts;
  }

  async listFindings(runId: string, query: FindingQuery = {}): Promise<Finding[]> {
    const filter = query.reproducible === undefined ? { runId } : { runId, reproducible: query.reproducible };
    return this.models.findings.find(filter, CHILD_PROJECTION).sort({ _id: 1 }).lean<Finding[]>();
  }

  async getFinding(findingId: string): Promise<Finding | null> {
    return this.models.findings.findOne({ id: findingId }, CHILD_PROJECTION).lean<Finding>();
  }

  async listDiagnoses(runId: string): Promise<Diagnosis[]> {
    return this.models.diagnoses.find({ runId }, CHILD_PROJECTION).sort({ _id: 1 }).lean<Diagnosis[]>();
  }

  async getDiagnosis(diagnosisId: string): Promise<Diagnosis | null> {
    return this.models.diagnoses.findOne({ id: diagnosisId }, CHILD_PROJECTION).lean<Diagnosis>();
  }

  async listPatches(runId: string): Promise<Patch[]> {
    return this.models.patches.find({ runId }, CHILD_PROJECTION).sort({ _id: 1 }).lean<Patch[]>();
  }

  async getPatch(patchId: string): Promise<Patch | null> {
    return this.models.patches.findOne({ id: patchId }, CHILD_PROJECTION).lean<Patch>();
  }

  async createRun(input: NewRun): Promise<Run> {
    return this.insertRun(buildNewRun(input));
  }

  async insertRun(run: Run): Promise<Run> {
    assertRunConsistent(run);
    try {
      await this.models.runs.create(run);
    } catch (error) {
      if (isDuplicateKey(error)) throw new StoreError("CONFLICT", `run ${run.id} already exists`);
      throw error;
    }
    return structuredClone(run);
  }

  async updateRun(runId: string, update: RunUpdate): Promise<Run> {
    const current = await this.getRun(runId);
    if (!current) throw notFound("run", runId);
    const next = applyRunUpdate(current, update);
    const updated = await this.models.runs
      .findOneAndUpdate(
        { id: runId, stage: current.stage, status: current.status },
        { $set: { stage: next.stage, status: next.status } },
        { new: true, projection: RUN_PROJECTION },
      )
      .lean<Run>();
    if (!updated) throw new StoreError("CONFLICT", `run ${runId} changed while it was being updated; retry`);
    return updated;
  }

  async addFindings(runId: string, findings: Finding[]): Promise<void> {
    await this.requireRun(runId);
    assertFindingsInsertable(runId, findings);
    if (findings.length === 0) return;
    await this.assertIdsFree("finding", this.models.findings, findings.map((f) => f.id));
    await this.insertChildren(this.models.findings, findings.map((f) => ({ ...f, runId })));
  }

  async recordReproduction(findingId: string, reproductionOutput?: string): Promise<Finding> {
    const current = await this.getFinding(findingId);
    if (!current) throw notFound("finding", findingId);
    assertReproductionRecordable(current);
    const next = reproducedFinding(current, reproductionOutput);
    const $set: Record<string, unknown> = { reproducible: true };
    if (next.reproductionOutput !== undefined) $set.reproductionOutput = next.reproductionOutput;
    const updated = await this.models.findings
      .findOneAndUpdate({ id: findingId, reproducible: false }, { $set }, { new: true, projection: CHILD_PROJECTION })
      .lean<Finding>();
    if (!updated) throw new StoreError("CONFLICT", `finding ${findingId} is already reproducible; its reproduction is final`);
    return updated;
  }

  async addDiagnoses(runId: string, diagnoses: Diagnosis[]): Promise<void> {
    await this.requireRun(runId);
    const cited = [...new Set(diagnoses.flatMap((d) => d.findingIds))];
    const present: string[] = cited.length ? await this.models.findings.distinct("id", { runId, id: { $in: cited } }) : [];
    assertDiagnosesInsertable(runId, diagnoses, new Set(present));
    if (diagnoses.length === 0) return;
    await this.assertIdsFree("diagnosis", this.models.diagnoses, diagnoses.map((d) => d.id));
    await this.insertChildren(this.models.diagnoses, diagnoses.map((d) => ({ ...d, runId })));
  }

  async savePatch(runId: string, patch: Patch): Promise<Patch> {
    await this.requireRun(runId);
    const [existingDoc, diagnosisExists] = await Promise.all([
      this.models.patches.findOne({ id: patch.id }, { _id: 0 }).lean<Patch & { runId: string }>(),
      this.models.diagnoses.exists({ runId, id: patch.diagnosisId }),
    ]);
    const existing = existingDoc ? { runId: existingDoc.runId, patch: existingDoc } : null;
    assertPatchWritable(runId, patch, existing, new Set(diagnosisExists ? [patch.diagnosisId] : []));

    const doc = { ...structuredClone(patch), runId };
    if (existing) {
      // Replace the whole document, so an optional field the new version omits is cleared too.
      const result = await this.models.patches.replaceOne({ id: patch.id, status: existing.patch.status }, doc);
      if (result.matchedCount === 0) throw new StoreError("CONFLICT", `patch ${patch.id} changed while it was being saved; retry`);
    } else {
      try {
        await this.models.patches.create(doc);
      } catch (error) {
        if (isDuplicateKey(error)) throw new StoreError("CONFLICT", `patch ${patch.id} already exists`);
        throw error;
      }
    }
    return structuredClone(patch);
  }

  async setPatchDecision(patchId: string, decision: PatchDecision): Promise<Patch> {
    const current = await this.getPatch(patchId);
    if (!current) throw notFound("patch", patchId);
    const next = decidedPatch(current, decision);
    const updated = await this.models.patches
      .findOneAndUpdate({ id: patchId, status: "verified" }, { $set: { status: next.status } }, { new: true, projection: CHILD_PROJECTION })
      .lean<Patch>();
    if (!updated) throw new StoreError("CONFLICT", `patch ${patchId} was decided concurrently; reload it`);
    return updated;
  }

  async ping(): Promise<void> {
    const db = this.conn.db;
    if (!db) throw new Error("MongoDB connection is not open");
    await db.command({ ping: 1 });
  }

  async close(): Promise<void> {
    await this.conn.close();
  }

  private async requireRun(runId: string): Promise<void> {
    if (!(await this.models.runs.exists({ id: runId }))) throw notFound("run", runId);
  }

  private async assertIdsFree(kind: string, model: Model<any>, ids: string[]): Promise<void> {
    const taken: string[] = await model.distinct("id", { id: { $in: ids } });
    if (taken.length > 0) throw new StoreError("CONFLICT", `${kind} ${taken.join(", ")} already exists`);
  }

  private async insertChildren(model: Model<any>, docs: object[]): Promise<void> {
    try {
      await model.insertMany(docs, { ordered: true });
    } catch (error) {
      if (isDuplicateKey(error)) throw new StoreError("CONFLICT", "an ID in this write already exists");
      throw error;
    }
  }
}
