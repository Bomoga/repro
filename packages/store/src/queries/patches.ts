// The patches collection. Repair and the Verification / Challenger Gate write Patches; the status
// surface reads them and records the human's merge or reject.
//
// Semantics carried from sections 4 and 5, enforced on every write:
// - `status` only advances proposed -> verified -> merged, or terminates at rejected.
// - `verified` requires all four deterministic gate inputs: tests passed, the original Finding no
//   longer reproduces, no regression Findings, and a confirmed Challenger verdict. The gate is
//   plain code, and so is this check; the store refuses a `verified` Patch that doesn't meet it.
// - `merged` is set only by a human merging the PR, so no Patch is ever inserted as merged.
import { PatchSchema, type Patch, type PatchStatus } from "../contracts.js";
import {
  DiagnosisNotFoundError,
  GateNotSatisfiedError,
  InvalidPatchTransitionError,
  PatchChangedError,
  PatchNotFoundError,
  RunNotFoundError,
  StoreError,
} from "../errors.js";
import type { StoreModels } from "../models.js";
import { clampLimit, insertOnce } from "./shared.js";

/** For each target status, the statuses a Patch may move to it from. */
export const PATCH_TRANSITIONS: Record<PatchStatus, readonly PatchStatus[]> = {
  proposed: [],
  verified: ["proposed"],
  merged: ["verified"],
  rejected: ["proposed", "verified"],
};

/** Section 5's gate, as the list of checks a Patch fails. Empty means it may be verified. */
export function gateFailures(patch: Pick<Patch, "testsPassed" | "originalFindingReproduces" | "regressionFindings" | "challengerVerdict">): string[] {
  const failures: string[] = [];
  if (!patch.testsPassed) failures.push("tests did not pass");
  if (patch.originalFindingReproduces) failures.push("the original finding still reproduces");
  if (patch.regressionFindings.length > 0) failures.push(`the patch introduced ${patch.regressionFindings.length} new finding(s)`);
  if (patch.challengerVerdict !== "confirmed") failures.push("the Challenger disputed the patch");
  return failures;
}

// The same gate as a Mongo filter, so the check and the status change happen in one atomic update.
const GATE_FILTER = {
  testsPassed: true,
  originalFindingReproduces: false,
  regressionFindings: { $size: 0 },
  challengerVerdict: "confirmed",
} as const;

export interface ListPatchesQuery {
  status?: PatchStatus | PatchStatus[];
}

// What Verify records on a proposed Patch: the Challenger's verdict, plus the deterministic results
// it re-confirmed (section 4: `reproductionOutputAfter` is captured by Repair and re-confirmed by
// Verify). Fields left out keep what Repair stored.
const PatchVerificationSchema = PatchSchema.pick({
  challengerVerdict: true,
  challengerNotes: true,
  testsPassed: true,
  originalFindingReproduces: true,
  reproductionOutputAfter: true,
  regressionFindings: true,
}).partial({ testsPassed: true, originalFindingReproduces: true, regressionFindings: true });

export type PatchVerification = Pick<Patch, "challengerVerdict"> &
  Partial<Pick<Patch, "challengerNotes" | "testsPassed" | "originalFindingReproduces" | "reproductionOutputAfter" | "regressionFindings">>;

export function patchQueries(models: StoreModels) {
  const { Patch: PatchModel, Diagnosis: DiagnosisModel, Run: RunModel } = models;

  async function load(id: string): Promise<Patch> {
    const doc = await PatchModel.findOne({ id }).lean();
    if (!doc) throw new PatchNotFoundError(id);
    return PatchSchema.parse(doc);
  }

  return {
    /**
     * Stores one Patch (one repair attempt) for a Run. Its Diagnosis must already be stored for
     * the same Run. Idempotent on `id`: re-sending a stored Patch returns the stored one unchanged.
     */
    async insert(runId: string, patch: Patch): Promise<Patch> {
      const parsed = PatchSchema.parse(patch);
      if (parsed.status === "merged") {
        throw new StoreError(`patch ${parsed.id} can't be stored as merged; only a human merging its PR sets merged`);
      }
      if (parsed.status === "verified") {
        const failures = gateFailures(parsed);
        if (failures.length > 0) throw new GateNotSatisfiedError(parsed.id, failures);
      }
      if (!(await RunModel.exists({ id: runId }))) throw new RunNotFoundError(runId);
      if (!(await DiagnosisModel.exists({ id: parsed.diagnosisId, runId }))) {
        throw new DiagnosisNotFoundError(parsed.diagnosisId);
      }
      await insertOnce(PatchModel, runId, [parsed]);
      return load(parsed.id);
    },

    /**
     * Replaces a stored Patch as Repair and the gate refine it: the Challenger's verdict and
     * notes, a re-run's output. It stays on its Run and Diagnosis, and its status may stay or move
     * along PATCH_TRANSITIONS, but never to `merged`, which only `transition` sets for a human's
     * merge. `verified` needs the gate, and a merged or rejected Patch never changes. The whole
     * document is replaced, so an optional field left out is cleared. Atomic on the stored status,
     * so a concurrent transition fails this write instead of being overwritten by it.
     */
    async replace(runId: string, patch: Patch): Promise<Patch> {
      const parsed = PatchSchema.parse(patch);
      if (parsed.status === "merged") {
        throw new StoreError(`patch ${parsed.id} can't be stored as merged; only a human merging its PR sets merged`);
      }
      if (parsed.status === "verified") {
        const failures = gateFailures(parsed);
        if (failures.length > 0) throw new GateNotSatisfiedError(parsed.id, failures);
      }
      const current = await PatchModel.findOne({ id: parsed.id }).lean();
      if (!current) throw new PatchNotFoundError(parsed.id);
      if (current.runId !== runId || current.diagnosisId !== parsed.diagnosisId) {
        throw new StoreError(`patch ${parsed.id} can't move to another run or diagnosis`);
      }
      const final = current.status === "merged" || current.status === "rejected";
      if (final || (parsed.status !== current.status && !PATCH_TRANSITIONS[parsed.status].includes(current.status))) {
        throw new InvalidPatchTransitionError(parsed.id, current.status, parsed.status);
      }
      const result = await PatchModel.replaceOne({ id: parsed.id, runId, status: current.status }, { ...parsed, runId });
      if (result.matchedCount === 0) throw new PatchChangedError(parsed.id);
      return load(parsed.id);
    },

    async get(id: string): Promise<Patch | null> {
      const doc = await PatchModel.findOne({ id }).lean();
      return doc ? PatchSchema.parse(doc) : null;
    },

    /** A Run's Patches in the order they were stored. */
    async list(runId: string, query: ListPatchesQuery = {}): Promise<Patch[]> {
      const filter: Record<string, unknown> = { runId };
      if (query.status !== undefined) filter.status = { $in: [query.status].flat() };
      const docs = await PatchModel.find(filter).sort({ _id: 1 }).lean();
      return docs.map((doc) => PatchSchema.parse(doc));
    },

    /** Every attempt at one Diagnosis, oldest first. Section 5 allows two. */
    async listByDiagnosis(diagnosisId: string): Promise<Patch[]> {
      const docs = await PatchModel.find({ diagnosisId }).sort({ _id: 1 }).lean();
      return docs.map((doc) => PatchSchema.parse(doc));
    },

    /** Patches in one status across every Run, newest first: `verified` is the merge queue. */
    async listByStatus(status: PatchStatus, options: { limit?: number } = {}): Promise<Patch[]> {
      const docs = await PatchModel.find({ status })
        .sort({ _id: -1 })
        .limit(clampLimit(options.limit, 50, 500))
        .lean();
      return docs.map((doc) => PatchSchema.parse(doc));
    },

    /**
     * Moves a Patch to a new status, if section 4 allows that move and, for `verified`, the gate
     * holds. The check and the write are one atomic update, so two callers racing (a double-click
     * on merge, say) can't both succeed. Lane 4's merge and reject are `merged` and `rejected`.
     */
    async transition(id: string, to: PatchStatus): Promise<Patch> {
      const from = PATCH_TRANSITIONS[to];
      const filter: Record<string, unknown> = { id, status: { $in: from } };
      if (to === "verified") Object.assign(filter, GATE_FILTER);
      const doc = await PatchModel.findOneAndUpdate(filter, { $set: { status: to } }, { returnDocument: "after" }).lean();
      if (doc) return PatchSchema.parse(doc);

      const current = await load(id);
      if (!from.includes(current.status)) throw new InvalidPatchTransitionError(id, current.status, to);
      throw new GateNotSatisfiedError(id, gateFailures(current));
    },

    /**
     * Records the Verification / Challenger Gate's inputs on a Patch that is still proposed. It
     * never changes `status`: the gate itself is `transition(id, "verified" | "rejected")`, which
     * re-checks these fields in the same atomic update.
     */
    async recordVerification(id: string, verification: PatchVerification): Promise<Patch> {
      const parsed = PatchVerificationSchema.parse(verification);
      const set = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined));
      const doc = await PatchModel.findOneAndUpdate({ id, status: "proposed" }, { $set: set }, { returnDocument: "after" }).lean();
      if (doc) return PatchSchema.parse(doc);
      const current = await load(id);
      throw new StoreError(`patch ${id} is ${current.status}; only a proposed patch can record a verification`);
    },

    /** Records the PR opened for a verified Patch. */
    async setPrUrl(id: string, prUrl: string): Promise<Patch> {
      const url = PatchSchema.shape.prUrl.unwrap().parse(prUrl);
      const doc = await PatchModel.findOneAndUpdate(
        { id, status: { $in: ["verified", "merged"] } },
        { $set: { prUrl: url } },
        { returnDocument: "after" },
      ).lean();
      if (doc) return PatchSchema.parse(doc);
      const current = await load(id);
      throw new StoreError(`patch ${id} is ${current.status}; only a verified or merged patch has a PR`);
    },
  };
}

export type PatchQueries = ReturnType<typeof patchQueries>;
