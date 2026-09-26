import { randomUUID } from "node:crypto";
import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import { StoreError, type NewRun, type PatchDecision, type RunCounts, type RunUpdate } from "./types.ts";

// The section 4 semantics notes that can be checked from stored data alone, shared by both Run
// Store implementations so they accept and reject exactly the same writes.

const FINAL_RUN_STATUSES: ReadonlySet<Run["status"]> = new Set(["completed", "failed"]);
const FINAL_PATCH_STATUSES: ReadonlySet<Patch["status"]> = new Set(["merged", "rejected"]);

export function logRefFor(runId: string): string {
  // The Run Store key of the run's retained prompt and tool-call log (section 9).
  return `run_logs/${runId}`;
}

export function buildNewRun(input: NewRun, now: Date = new Date(), id = `run_${randomUUID()}`): Run {
  return {
    id,
    trigger: input.trigger,
    target: { kind: input.target.kind, ref: input.target.ref },
    stage: "ingest",
    status: "queued",
    startedAt: now.toISOString(),
    logRef: logRefFor(id),
  };
}

/** `stage` is the stage in flight, so "done" (nothing in flight) and "completed" go together. */
export function assertRunConsistent(run: Run): void {
  if ((run.stage === "done") !== (run.status === "completed")) {
    throw new StoreError(
      "INVALID",
      `run ${run.id}: stage "${run.stage}" with status "${run.status}" is contradictory; stage "done" and status "completed" are only valid together`,
    );
  }
}

export function applyRunUpdate(run: Run, update: RunUpdate): Run {
  if (FINAL_RUN_STATUSES.has(run.status)) {
    throw new StoreError("CONFLICT", `run ${run.id} is ${run.status} and can no longer change`);
  }
  const next: Run = { ...run, stage: update.stage ?? run.stage, status: update.status ?? run.status };
  assertRunConsistent(next);
  return next;
}

export function assertFindingsInsertable(runId: string, findings: Finding[]): void {
  const seen = new Set<string>();
  for (const finding of findings) {
    if (seen.has(finding.id)) throw new StoreError("CONFLICT", `finding ${finding.id} appears twice in one write`);
    seen.add(finding.id);
    // reproductionOutput is the output that flipped reproducible to true: absent whenever it's false.
    if (!finding.reproducible && finding.reproductionOutput !== undefined) {
      throw new StoreError(
        "INVALID",
        `finding ${finding.id} in run ${runId} carries reproductionOutput but is not reproducible`,
      );
    }
  }
}

/** reproducible only ever goes false -> true, and reproductionOutput is never edited afterward. */
export function assertReproductionRecordable(finding: Finding): void {
  if (finding.reproducible) {
    throw new StoreError("CONFLICT", `finding ${finding.id} is already reproducible; its reproduction is final`);
  }
}

export function reproducedFinding(finding: Finding, reproductionOutput: string | undefined): Finding {
  const next: Finding = { ...finding, reproducible: true };
  if (reproductionOutput !== undefined) next.reproductionOutput = reproductionOutput;
  return next;
}

/** A Diagnosis must cite at least one Finding, and only Findings of its own Run. */
export function assertDiagnosesInsertable(runId: string, diagnoses: Diagnosis[], runFindingIds: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const diagnosis of diagnoses) {
    if (seen.has(diagnosis.id)) throw new StoreError("CONFLICT", `diagnosis ${diagnosis.id} appears twice in one write`);
    seen.add(diagnosis.id);
    if (diagnosis.findingIds.length === 0) {
      throw new StoreError("INVALID", `diagnosis ${diagnosis.id} cites no Finding IDs`);
    }
    const unknown = diagnosis.findingIds.filter((id) => !runFindingIds.has(id));
    if (unknown.length > 0) {
      throw new StoreError(
        "INVALID",
        `diagnosis ${diagnosis.id} cites Finding IDs that are not in run ${runId}: ${unknown.join(", ")}`,
      );
    }
  }
}

/** The Verification gate's rule (section 5); the store refuses a "verified" Patch that lacks its proof. */
export function meetsVerificationGate(patch: Patch): boolean {
  return (
    patch.testsPassed &&
    !patch.originalFindingReproduces &&
    patch.regressionFindings.length === 0 &&
    patch.challengerVerdict === "confirmed"
  );
}

export interface StoredPatch {
  runId: string;
  patch: Patch;
}

/**
 * Status only advances proposed -> verified -> merged, or terminates at rejected. Only the gate
 * sets verified (and the Patch must carry the gate's inputs), only setPatchDecision sets merged,
 * and merged and rejected are final.
 */
export function assertPatchWritable(
  runId: string,
  patch: Patch,
  existing: StoredPatch | null,
  runDiagnosisIds: ReadonlySet<string>,
): void {
  if (!runDiagnosisIds.has(patch.diagnosisId)) {
    throw new StoreError("INVALID", `patch ${patch.id} names diagnosis ${patch.diagnosisId}, which is not in run ${runId}`);
  }
  if (patch.status === "merged") {
    throw new StoreError("INVALID", `patch ${patch.id}: only a person's merge decision can set status "merged"`);
  }
  if (patch.status === "verified" && !meetsVerificationGate(patch)) {
    throw new StoreError(
      "INVALID",
      `patch ${patch.id} is marked verified without passing the gate (tests pass, original Finding no longer reproduces, no regressions, Challenger confirmed)`,
    );
  }
  if (!existing) return;

  if (existing.runId !== runId || existing.patch.diagnosisId !== patch.diagnosisId) {
    throw new StoreError("INVALID", `patch ${patch.id} cannot move to a different run or diagnosis`);
  }
  const from = existing.patch.status;
  if (FINAL_PATCH_STATUSES.has(from)) {
    throw new StoreError("CONFLICT", `patch ${patch.id} is ${from} and can no longer change`);
  }
  if (from === "verified" && patch.status === "proposed") {
    throw new StoreError("INVALID", `patch ${patch.id} cannot go back from verified to proposed`);
  }
}

export function decidedPatch(patch: Patch, decision: PatchDecision): Patch {
  if (patch.status !== "verified") {
    throw new StoreError("CONFLICT", `patch ${patch.id} is ${patch.status}; only a verified patch can be merged or rejected`);
  }
  return { ...patch, status: decision === "merge" ? "merged" : "rejected" };
}

export function emptyCounts(): RunCounts {
  return { findings: 0, reproducible: 0, diagnoses: 0, patches: 0, verifiedPatches: 0 };
}

export function isVerifiedStatus(status: Patch["status"]): boolean {
  return status === "verified" || status === "merged";
}

export function notFound(kind: string, id: string): StoreError {
  return new StoreError("NOT_FOUND", `${kind} not found: ${id}`);
}
