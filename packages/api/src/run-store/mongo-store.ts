import mongoose from "mongoose";
import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import { DiagnosisModel, FindingModel, PatchModel, RunModel } from "./mongo-schemas.js";
import { RunNotFoundError, type RunStore } from "./store.js";

export async function connectMongo(uri: string): Promise<typeof mongoose> {
  return mongoose.connect(uri);
}

function toRun(doc: { _id: unknown } & Record<string, unknown>): Run {
  const { _id, ...rest } = doc;
  return { id: String(_id), ...rest } as Run;
}

function toContract<T extends { id: string }>(doc: Record<string, unknown>): T {
  const { _id, runId, __v, ...rest } = doc as Record<string, unknown> & { _id?: unknown; runId?: unknown };
  void _id;
  void runId;
  void __v;
  return rest as T;
}

/** Mongoose-backed Run Store (section 9's persistence layer for the status surface). */
export class MongoRunStore implements RunStore {
  async createRun(run: Run): Promise<Run> {
    const { id, ...rest } = run;
    const doc = await RunModel.create({ _id: id, ...rest });
    return toRun(doc.toObject());
  }

  async getRun(id: string): Promise<Run | null> {
    const doc = await RunModel.findById(id).lean();
    return doc ? toRun(doc as { _id: unknown } & Record<string, unknown>) : null;
  }

  async listRuns(opts?: { limit?: number }): Promise<Run[]> {
    let query = RunModel.find().sort({ startedAt: -1 });
    if (opts?.limit) query = query.limit(opts.limit);
    const docs = await query.lean();
    return docs.map((doc) => toRun(doc as { _id: unknown } & Record<string, unknown>));
  }

  async updateRun(id: string, patch: Partial<Omit<Run, "id">>): Promise<Run | null> {
    const doc = await RunModel.findByIdAndUpdate(id, patch, { new: true }).lean();
    return doc ? toRun(doc as { _id: unknown } & Record<string, unknown>) : null;
  }

  async addFindings(runId: string, findings: Finding[]): Promise<void> {
    await this.requireRun(runId);
    if (findings.length === 0) return;
    await FindingModel.insertMany(findings.map((finding) => ({ ...finding, runId })));
  }

  async listFindings(runId: string): Promise<Finding[]> {
    const docs = await FindingModel.find({ runId }).lean();
    return docs.map((doc) => toContract<Finding>(doc as Record<string, unknown>));
  }

  async addDiagnoses(runId: string, diagnoses: Diagnosis[]): Promise<void> {
    await this.requireRun(runId);
    if (diagnoses.length === 0) return;
    await DiagnosisModel.insertMany(diagnoses.map((diagnosis) => ({ ...diagnosis, runId })));
  }

  async listDiagnoses(runId: string): Promise<Diagnosis[]> {
    const docs = await DiagnosisModel.find({ runId }).lean();
    return docs.map((doc) => toContract<Diagnosis>(doc as Record<string, unknown>));
  }

  async addPatch(runId: string, patch: Patch): Promise<void> {
    await this.requireRun(runId);
    await PatchModel.create({ ...patch, runId });
  }

  async listPatches(runId: string): Promise<Patch[]> {
    const docs = await PatchModel.find({ runId }).lean();
    return docs.map((doc) => toContract<Patch>(doc as Record<string, unknown>));
  }

  async updatePatch(runId: string, patchId: string, patch: Partial<Omit<Patch, "id">>): Promise<Patch | null> {
    const doc = await PatchModel.findOneAndUpdate({ runId, id: patchId }, patch, { new: true }).lean();
    return doc ? toContract<Patch>(doc as Record<string, unknown>) : null;
  }

  private async requireRun(runId: string): Promise<void> {
    const exists = await RunModel.exists({ _id: runId });
    if (!exists) throw new RunNotFoundError(runId);
  }
}
