import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";

/**
 * The Run Store: the one place the status surface reads Runs, Findings, Diagnoses, and Patches
 * from. `runId` associates a Finding/Diagnosis/Patch with the Run that produced it; that
 * association is a storage-side concern (section 9), not part of the section 4 contracts
 * themselves, so it lives only in this interface's signatures, never inside the contract objects.
 */
export interface RunStore {
  createRun(run: Run): Promise<Run>;
  getRun(id: string): Promise<Run | null>;
  listRuns(opts?: { limit?: number }): Promise<Run[]>;
  updateRun(id: string, patch: Partial<Omit<Run, "id">>): Promise<Run | null>;

  addFindings(runId: string, findings: Finding[]): Promise<void>;
  listFindings(runId: string): Promise<Finding[]>;

  addDiagnoses(runId: string, diagnoses: Diagnosis[]): Promise<void>;
  listDiagnoses(runId: string): Promise<Diagnosis[]>;

  addPatch(runId: string, patch: Patch): Promise<void>;
  listPatches(runId: string): Promise<Patch[]>;
  updatePatch(runId: string, patchId: string, patch: Partial<Omit<Patch, "id">>): Promise<Patch | null>;
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`run not found: ${runId}`);
    this.name = "RunNotFoundError";
  }
}
