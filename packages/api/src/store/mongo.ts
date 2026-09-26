import * as z from "zod";
import { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import * as runStore from "@repro/store";
import {
  applyRunUpdate,
  assertDiagnosesInsertable,
  assertFindingsInsertable,
  assertPatchWritable,
  assertReproductionRecordable,
  assertRunConsistent,
  decidedPatch,
  emptyCounts,
  isVerifiedStatus,
  notFound,
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

// MongoDB Atlas is Lane 1's Run Store (@repro/store): its collections, indexes, and write rules.
// This is the API's RunStore over it. Every write checks Lane 4's invariants first, the same ones
// the in-memory store enforces, so the two stores accept and refuse exactly the same writes; then
// it goes through @repro/store, which validates it again. Reads @repro/store has no helper for
// (paging with an offset, insertion order, per-Run tallies) use its exported models, parsed back
// into contracts.

export interface MongoRunStoreOptions {
  /** Database name; defaults to @repro/store's choice: REPRO_MONGODB_DB, the URI's, then "repro". */
  dbName?: string;
  serverSelectionTimeoutMS?: number;
}

/** A refusal from @repro/store, or a duplicate key, as the StoreError the router maps to a code. */
function toStoreError(error: unknown): unknown {
  if (error instanceof StoreError) return error;
  if (
    error instanceof runStore.RunNotFoundError ||
    error instanceof runStore.FindingNotFoundError ||
    error instanceof runStore.PatchNotFoundError
  ) {
    return new StoreError("NOT_FOUND", error.message);
  }
  if (
    error instanceof runStore.RunNotActiveError ||
    error instanceof runStore.InvalidPatchTransitionError ||
    error instanceof runStore.PatchChangedError
  ) {
    return new StoreError("CONFLICT", error.message);
  }
  if (error instanceof runStore.StoreError || error instanceof z.ZodError) return new StoreError("INVALID", error.message);
  if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000) {
    return new StoreError("CONFLICT", "an ID in this write already exists");
  }
  return error;
}

async function write<T>(pending: Promise<T>): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    throw toStoreError(error);
  }
}

export class MongoRunStore implements RunStore {
  readonly kind = "mongo" as const;

  private readonly store: runStore.RunStore;

  private constructor(store: runStore.RunStore) {
    this.store = store;
  }

  /** Connects through @repro/store on a dedicated connection and builds its indexes, whose unique
   *  `id`s back the duplicate checks below. */
  static async connect(uri: string, options: MongoRunStoreOptions = {}): Promise<MongoRunStore> {
    const connection = await runStore.openConnection({
      uri,
      dbName: options.dbName,
      serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 10_000,
    });
    const store = runStore.createRunStore(connection);
    try {
      await store.ensureIndexes();
    } catch (error) {
      await store.close().catch(() => {});
      throw error;
    }
    return new MongoRunStore(store);
  }

  private get models(): runStore.StoreModels {
    return this.store.models;
  }

  async listRuns(query: RunQuery = {}): Promise<Run[]> {
    const limit = query.limit ?? DEFAULT_RUN_LIMIT;
    if (limit <= 0) return []; // Mongo reads limit(0) as "no limit"
    const docs = await this.models.Run.find(query.status ? { status: query.status } : {})
      .sort({ startedAt: -1, id: 1 })
      .skip(query.offset ?? 0)
      .limit(limit)
      .lean();
    return docs.map((doc) => Run.parse(doc));
  }

  async getRun(runId: string): Promise<Run | null> {
    return this.store.runs.get(runId);
  }

  async countRuns(runIds: string[]): Promise<Record<string, RunCounts>> {
    const counts: Record<string, RunCounts> = {};
    for (const runId of runIds) counts[runId] = emptyCounts();
    if (runIds.length === 0) return counts;

    const inRuns = { runId: { $in: runIds } };
    const [findings, diagnoses, patches] = await Promise.all([
      this.models.Finding.find(inRuns, { _id: 0, runId: 1, reproducible: 1 }).lean(),
      this.models.Diagnosis.find(inRuns, { _id: 0, runId: 1 }).lean(),
      this.models.Patch.find(inRuns, { _id: 0, runId: 1, status: 1 }).lean(),
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
    const docs = await this.models.Finding.find(filter).sort({ _id: 1 }).lean();
    return docs.map((doc) => Finding.parse(doc));
  }

  async getFinding(findingId: string): Promise<Finding | null> {
    return this.store.findings.get(findingId);
  }

  async listDiagnoses(runId: string): Promise<Diagnosis[]> {
    const docs = await this.models.Diagnosis.find({ runId }).sort({ _id: 1 }).lean();
    return docs.map((doc) => Diagnosis.parse(doc));
  }

  async getDiagnosis(diagnosisId: string): Promise<Diagnosis | null> {
    return this.store.diagnoses.get(diagnosisId);
  }

  async listPatches(runId: string): Promise<Patch[]> {
    return this.store.patches.list(runId);
  }

  async getPatch(patchId: string): Promise<Patch | null> {
    return this.store.patches.get(patchId);
  }

  async createRun(input: NewRun): Promise<Run> {
    return write(this.store.runs.create({ target: input.target, trigger: input.trigger }));
  }

  async insertRun(run: Run): Promise<Run> {
    assertRunConsistent(run);
    return write(this.store.runs.insert(run));
  }

  async updateRun(runId: string, update: RunUpdate): Promise<Run> {
    const current = await this.getRun(runId);
    if (!current) throw notFound("run", runId);
    // applyRunUpdate keeps "done" with "completed", so any other stage below is one still in flight.
    const next = applyRunUpdate(current, update);
    const { runs } = this.store;
    return write(
      (async () => {
        if (next.status === "completed") return runs.complete(runId);
        let run = current;
        if (next.stage !== current.stage) run = await runs.setStage(runId, next.stage as Exclude<Run["stage"], "done">);
        if (next.status === "failed") return runs.fail(runId);
        if (next.status !== current.status) run = await runs.setStatus(runId, next.status as runStore.ActiveRunStatus);
        return run;
      })(),
    );
  }

  async addFindings(runId: string, findings: Finding[]): Promise<void> {
    await this.requireRun(runId);
    assertFindingsInsertable(runId, findings);
    if (findings.length === 0) return;
    const taken = await this.models.Finding.distinct("id", { id: { $in: findings.map((f) => f.id) } });
    if (taken.length > 0) throw new StoreError("CONFLICT", `finding ${taken.join(", ")} already exists`);
    await write(this.store.findings.insert(runId, findings));
  }

  async recordReproduction(findingId: string, reproductionOutput?: string): Promise<Finding> {
    const current = await this.getFinding(findingId);
    if (!current) throw notFound("finding", findingId);
    assertReproductionRecordable(current);
    const next = await write(this.store.findings.markReproducible(findingId, reproductionOutput));
    // markReproducible hands back a Finding another writer flipped first, as it was stored.
    if (next.reproductionOutput !== reproductionOutput) {
      throw new StoreError("CONFLICT", `finding ${findingId} is already reproducible; its reproduction is final`);
    }
    return next;
  }

  async addDiagnoses(runId: string, diagnoses: Diagnosis[]): Promise<void> {
    await this.requireRun(runId);
    const cited = [...new Set(diagnoses.flatMap((d) => d.findingIds))];
    const present = cited.length > 0 ? await this.models.Finding.distinct("id", { runId, id: { $in: cited } }) : [];
    assertDiagnosesInsertable(runId, diagnoses, new Set(present));
    if (diagnoses.length === 0) return;
    const taken = await this.models.Diagnosis.distinct("id", { id: { $in: diagnoses.map((d) => d.id) } });
    if (taken.length > 0) throw new StoreError("CONFLICT", `diagnosis ${taken.join(", ")} already exists`);
    await write(this.store.diagnoses.insert(runId, diagnoses));
  }

  async savePatch(runId: string, patch: Patch): Promise<Patch> {
    await this.requireRun(runId);
    const [stored, diagnosisInRun] = await Promise.all([
      this.models.Patch.findOne({ id: patch.id }).lean(),
      this.models.Diagnosis.exists({ runId, id: patch.diagnosisId }),
    ]);
    const existing = stored ? { runId: stored.runId, patch: Patch.parse(stored) } : null;
    assertPatchWritable(runId, patch, existing, new Set(diagnosisInRun ? [patch.diagnosisId] : []));
    return write(existing ? this.store.patches.replace(runId, patch) : this.store.patches.insert(runId, patch));
  }

  async setPatchDecision(patchId: string, decision: PatchDecision): Promise<Patch> {
    const current = await this.getPatch(patchId);
    if (!current) throw notFound("patch", patchId);
    const next = decidedPatch(current, decision);
    return write(this.store.patches.transition(patchId, next.status));
  }

  async ping(): Promise<void> {
    const db = this.store.connection.db;
    if (!db) throw new Error("MongoDB connection is not open");
    await db.command({ ping: 1 });
  }

  async close(): Promise<void> {
    await this.store.close();
  }

  private async requireRun(runId: string): Promise<void> {
    if (!(await this.store.runs.exists(runId))) throw notFound("run", runId);
  }
}
