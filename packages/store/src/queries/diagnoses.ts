// The diagnoses collection. Diagnose writes; Repair, the Challenger, and the status surface read.
//
// Semantics carried from sections 4 and 5: a Diagnosis must cite Finding IDs, and nothing else is
// legal. Diagnose's response schema already limits `findingIds` to the IDs in its batch; the store
// is the last check before persistence, and refuses a Diagnosis that cites nothing, or cites an ID
// Detect never produced for the same Run.
import { DiagnosisSchema, type Diagnosis } from "../contracts.js";
import { CitationError, RunNotFoundError } from "../errors.js";
import type { StoreModels } from "../models.js";
import { insertOnce, type WriteSummary } from "./shared.js";

export function diagnosisQueries(models: StoreModels) {
  const { Diagnosis: DiagnosisModel, Finding: FindingModel, Run: RunModel } = models;

  return {
    /**
     * Stores a batch of Diagnoses for a Run, after checking every citation against the Run's
     * Findings. One bad citation rejects the whole batch, before anything is written.
     * Idempotent, like Finding inserts.
     */
    async insert(runId: string, diagnoses: Diagnosis[]): Promise<WriteSummary> {
      const parsed = diagnoses.map((diagnosis) => DiagnosisSchema.parse(diagnosis));
      if (!(await RunModel.exists({ id: runId }))) throw new RunNotFoundError(runId);

      for (const diagnosis of parsed) {
        if (diagnosis.findingIds.length === 0) throw new CitationError(diagnosis.id, []);
      }
      const cited = [...new Set(parsed.flatMap((diagnosis) => diagnosis.findingIds))];
      const found = await FindingModel.find({ runId, id: { $in: cited } }, { id: 1 }).lean();
      const known = new Set(found.map((doc) => doc.id));
      for (const diagnosis of parsed) {
        const missing = diagnosis.findingIds.filter((id) => !known.has(id));
        if (missing.length > 0) throw new CitationError(diagnosis.id, missing);
      }
      return insertOnce(DiagnosisModel, runId, parsed);
    },

    async get(id: string): Promise<Diagnosis | null> {
      const doc = await DiagnosisModel.findOne({ id }).lean();
      return doc ? DiagnosisSchema.parse(doc) : null;
    },

    /** A Run's Diagnoses, oldest first. */
    async list(runId: string): Promise<Diagnosis[]> {
      const docs = await DiagnosisModel.find({ runId }).sort({ createdAt: 1 }).lean();
      return docs.map((doc) => DiagnosisSchema.parse(doc));
    },

    /** Every Diagnosis that cites this Finding. */
    async citing(findingId: string): Promise<Diagnosis[]> {
      const docs = await DiagnosisModel.find({ findingIds: findingId }).sort({ createdAt: 1 }).lean();
      return docs.map((doc) => DiagnosisSchema.parse(doc));
    },

    /**
     * The Diagnoses allowed to move on to Repair (section 5): every Finding each one cites is
     * `reproducible: true`. The rest stay explained but unconfirmed.
     */
    async listRepairable(runId: string): Promise<Diagnosis[]> {
      const [docs, confirmed] = await Promise.all([
        DiagnosisModel.find({ runId }).sort({ createdAt: 1 }).lean(),
        FindingModel.find({ runId, reproducible: true }, { id: 1 }).lean(),
      ]);
      const reproducible = new Set(confirmed.map((doc) => doc.id));
      return docs
        .map((doc) => DiagnosisSchema.parse(doc))
        .filter((diagnosis) => diagnosis.findingIds.length > 0 && diagnosis.findingIds.every((id) => reproducible.has(id)));
    },
  };
}

export type DiagnosisQueries = ReturnType<typeof diagnosisQueries>;
