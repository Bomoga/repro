// Errors the Run Store throws when a write would break a section 4 or section 5 rule. Each one
// names the rule, so the caller's log says why the write was refused, not just that it was.
import type { PatchStatus, RunStatus } from "./contracts.js";

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class RunNotFoundError extends StoreError {
  readonly runId: string;
  constructor(runId: string) {
    super(`run not found: ${runId}`);
    this.runId = runId;
  }
}

/** A completed or failed Run is the finished record of one pipeline execution; it never changes again. */
export class RunNotActiveError extends StoreError {
  readonly runId: string;
  readonly status: RunStatus;
  constructor(runId: string, status: RunStatus) {
    super(`run ${runId} is ${status}; only a queued, running, or blocked run can change`);
    this.runId = runId;
    this.status = status;
  }
}

export class FindingNotFoundError extends StoreError {
  readonly findingId: string;
  constructor(findingId: string) {
    super(`finding not found: ${findingId}`);
    this.findingId = findingId;
  }
}

/** Section 4: with no `reproductionCommand`, `reproducible` stays false indefinitely. */
export class NotReproducibleError extends StoreError {
  readonly findingId: string;
  constructor(findingId: string) {
    super(`finding ${findingId} has no reproductionCommand, so it can never be marked reproducible`);
    this.findingId = findingId;
  }
}

export class DiagnosisNotFoundError extends StoreError {
  readonly diagnosisId: string;
  constructor(diagnosisId: string) {
    super(`diagnosis not found: ${diagnosisId}`);
    this.diagnosisId = diagnosisId;
  }
}

/** Section 4: a Diagnosis must cite Finding IDs, and only IDs Detect produced for the same Run. */
export class CitationError extends StoreError {
  readonly diagnosisId: string;
  readonly missingFindingIds: string[];
  constructor(diagnosisId: string, missingFindingIds: string[]) {
    super(
      missingFindingIds.length === 0
        ? `diagnosis ${diagnosisId} cites no findings`
        : `diagnosis ${diagnosisId} cites findings that are not in its run: ${missingFindingIds.join(", ")}`,
    );
    this.diagnosisId = diagnosisId;
    this.missingFindingIds = missingFindingIds;
  }
}

export class PatchNotFoundError extends StoreError {
  readonly patchId: string;
  constructor(patchId: string) {
    super(`patch not found: ${patchId}`);
    this.patchId = patchId;
  }
}

/** Section 4: `status` only advances proposed -> verified -> merged, or terminates at rejected. */
export class InvalidPatchTransitionError extends StoreError {
  readonly patchId: string;
  readonly from: PatchStatus;
  readonly to: PatchStatus;
  constructor(patchId: string, from: PatchStatus, to: PatchStatus) {
    super(`patch ${patchId} cannot move from ${from} to ${to}`);
    this.patchId = patchId;
    this.from = from;
    this.to = to;
  }
}

/** A Patch changed between being read and being replaced; the caller reloads it and decides again. */
export class PatchChangedError extends StoreError {
  readonly patchId: string;
  constructor(patchId: string) {
    super(`patch ${patchId} changed while it was being replaced; reload it`);
    this.patchId = patchId;
  }
}

/** Section 5: `verified` only when every deterministic gate input holds. */
export class GateNotSatisfiedError extends StoreError {
  readonly patchId: string;
  readonly failedChecks: string[];
  constructor(patchId: string, failedChecks: string[]) {
    super(`patch ${patchId} cannot be verified: ${failedChecks.join("; ")}`);
    this.patchId = patchId;
    this.failedChecks = failedChecks;
  }
}
