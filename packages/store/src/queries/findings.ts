// The findings collection. Detect writes Findings, the reproduction step flips `reproducible`, and
// nothing else writes here: Diagnose and Repair only read.
//
// Semantics carried from section 4: `reproducible` is only ever flipped to true, and only by
// actually running `reproductionCommand` through the Executor. The store can't see the Executor,
// but it enforces the two parts it can: there is no way to set `reproducible` back to false, and a
// Finding with no `reproductionCommand` can never be marked reproducible at all.
import { FindingSchema, type Finding, type Severity } from "../contracts.js";
import { FindingNotFoundError, NotReproducibleError, RunNotFoundError } from "../errors.js";
import type { StoreModels } from "../models.js";
import { asArray, insertOnce, type WriteSummary } from "./shared.js";

export interface ListFindingsQuery {
  /** true: confirmed only. false: unconfirmed only. Omitted: both. */
  reproducible?: boolean;
  detectorId?: string | string[];
  severity?: Severity | Severity[];
  category?: string | string[];
}

export interface FindingCounts {
  /** Everything the detectors flagged. */
  total: number;
  /** What the reproduction step confirmed. */
  reproducible: number;
}

export function findingQueries(models: StoreModels) {
  const { Finding: FindingModel, Run: RunModel } = models;

  return {
    /**
     * Stores a batch of Findings for a Run. Each one is validated against the contract first.
     * Idempotent: re-sending a Finding that's already stored leaves the stored one as it is.
     */
    async insert(runId: string, findings: Finding[]): Promise<WriteSummary> {
      const parsed = findings.map((finding) => FindingSchema.parse(finding));
      if (!(await RunModel.exists({ id: runId }))) throw new RunNotFoundError(runId);
      return insertOnce(FindingModel, runId, parsed);
    },

    async get(id: string): Promise<Finding | null> {
      const doc = await FindingModel.findOne({ id }).lean();
      return doc ? FindingSchema.parse(doc) : null;
    },

    /** The Findings with these IDs, in no particular order; unknown IDs are skipped. */
    async getMany(ids: string[]): Promise<Finding[]> {
      if (ids.length === 0) return [];
      const docs = await FindingModel.find({ id: { $in: ids } }).lean();
      return docs.map((doc) => FindingSchema.parse(doc));
    },

    /** A Run's Findings in file order: file, then line, then id. */
    async list(runId: string, query: ListFindingsQuery = {}): Promise<Finding[]> {
      const filter: Record<string, unknown> = { runId };
      if (query.reproducible !== undefined) filter.reproducible = query.reproducible;
      const detectorIds = asArray(query.detectorId);
      if (detectorIds) filter.detectorId = { $in: detectorIds };
      const severities = asArray(query.severity);
      if (severities) filter.severity = { $in: severities };
      const categories = asArray(query.category);
      if (categories) filter.category = { $in: categories };
      const docs = await FindingModel.find(filter).sort({ file: 1, lineStart: 1, id: 1 }).lean();
      return docs.map((doc) => FindingSchema.parse(doc));
    },

    /** How many Findings the detectors raised, and how many the reproduction step confirmed. */
    async counts(runId: string): Promise<FindingCounts> {
      const [total, reproducible] = await Promise.all([
        FindingModel.countDocuments({ runId }),
        FindingModel.countDocuments({ runId, reproducible: true }),
      ]);
      return { total, reproducible };
    },

    /**
     * Called by the reproduction step, and nothing else, once running the Finding's
     * `reproductionCommand` through the Executor has demonstrated the issue. `reproductionOutput`
     * is that run's verbatim excerpt, stored with the flip and never edited afterward.
     * Idempotent: a Finding that's already reproducible comes back as stored.
     */
    async markReproducible(id: string, reproductionOutput?: string): Promise<Finding> {
      const set: Record<string, unknown> = { reproducible: true };
      if (reproductionOutput !== undefined) {
        set.reproductionOutput = FindingSchema.shape.reproductionOutput.unwrap().parse(reproductionOutput);
      }
      const doc = await FindingModel.findOneAndUpdate(
        { id, reproducible: false, reproductionCommand: { $type: "string", $ne: "" } },
        { $set: set },
        { returnDocument: "after" },
      ).lean();
      if (doc) return FindingSchema.parse(doc);
      const existing = await FindingModel.findOne({ id }).lean();
      if (!existing) throw new FindingNotFoundError(id);
      if (existing.reproducible) return FindingSchema.parse(existing);
      throw new NotReproducibleError(id);
    },
  };
}

export type FindingQueries = ReturnType<typeof findingQueries>;
