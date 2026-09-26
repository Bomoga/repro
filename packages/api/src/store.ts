import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";

// The Run Store: the one place every stage of the pipeline (ingest, detect, diagnose, repair,
// verify) writes to and the status surface reads from. Lane 4 only reads and does the two
// writes the status surface itself owns: advancing a Patch's status via merge/reject, and
// creating a queued Run when the CLI/dashboard kicks one off manually.
//
// Two toggles only, per the "no chat surface" rule: a target ref to start a Run, and
// merge/reject on a Patch. Nothing else here takes free-form input.
export interface RunQuery {
  status?: Run["status"];
  limit?: number;
}

export interface RunStore {
  createRun(input: { target: Run["target"]; trigger: Run["trigger"] }): Promise<Run>;
  listRuns(query?: RunQuery): Promise<Run[]>;
  getRun(runId: string): Promise<Run | null>;

  listFindings(runId: string): Promise<Finding[]>;
  listDiagnoses(runId: string): Promise<Diagnosis[]>;

  listPatches(runId: string): Promise<Patch[]>;
  getPatch(patchId: string): Promise<Patch | null>;
  /** The only write the status surface makes to a Patch: advancing it toward merged, or
   *  terminating it at rejected. Never sets any other status (that belongs to Verify). */
  setPatchDecision(patchId: string, decision: "merge" | "reject"): Promise<Patch>;
}

export class PatchNotFoundError extends Error {
  constructor(patchId: string) {
    super(`patch not found: ${patchId}`);
    this.name = "PatchNotFoundError";
  }
}

export class InvalidPatchDecisionError extends Error {
  constructor(patchId: string, status: Patch["status"]) {
    super(`patch ${patchId} is ${status}, not eligible for merge/reject`);
    this.name = "InvalidPatchDecisionError";
  }
}

interface RunRecord {
  run: Run;
  findings: Finding[];
  diagnoses: Diagnosis[];
  patches: Patch[];
}

/** Default store when no MONGODB_URI is configured: dev and unit tests. Data does not survive
 *  a restart, which is fine since Lane 4 never originates Findings/Diagnoses/Patches itself. */
export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunRecord>();

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
    this.runs.set(run.id, { run, findings: [], diagnoses: [], patches: [] });
    return run;
  }

  async listRuns(query: RunQuery = {}): Promise<Run[]> {
    let runs = [...this.runs.values()].map((r) => r.run);
    if (query.status) runs = runs.filter((r) => r.status === query.status);
    runs = runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return query.limit ? runs.slice(0, query.limit) : runs;
  }

  async getRun(runId: string): Promise<Run | null> {
    return this.runs.get(runId)?.run ?? null;
  }

  async listFindings(runId: string): Promise<Finding[]> {
    return this.runs.get(runId)?.findings ?? [];
  }

  async listDiagnoses(runId: string): Promise<Diagnosis[]> {
    return this.runs.get(runId)?.diagnoses ?? [];
  }

  async listPatches(runId: string): Promise<Patch[]> {
    return this.runs.get(runId)?.patches ?? [];
  }

  async getPatch(patchId: string): Promise<Patch | null> {
    for (const record of this.runs.values()) {
      const patch = record.patches.find((p) => p.id === patchId);
      if (patch) return patch;
    }
    return null;
  }

  async setPatchDecision(patchId: string, decision: "merge" | "reject"): Promise<Patch> {
    for (const record of this.runs.values()) {
      const patch = record.patches.find((p) => p.id === patchId);
      if (!patch) continue;
      if (patch.status !== "verified") throw new InvalidPatchDecisionError(patchId, patch.status);
      patch.status = decision === "merge" ? "merged" : "rejected";
      return patch;
    }
    throw new PatchNotFoundError(patchId);
  }

  /** Test/dev seeding only; not part of the RunStore interface other stages depend on. */
  seed(record: RunRecord): void {
    this.runs.set(record.run.id, record);
  }
}
