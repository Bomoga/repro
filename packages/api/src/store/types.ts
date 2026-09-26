import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";

// The Run Store (CLAUDE.md sections 3 and 10): Runs, Findings, Diagnoses, and Patches, the single
// source of truth for the CLI, the dashboard, and GitHub Checks. Every object going in or out is
// exactly a section 4 contract; which Run a Finding, Diagnosis, or Patch belongs to is a storage
// detail passed alongside it, never a field added to the contract.
//
// Reads serve the status surface. Writes serve the orchestrator and pipeline stages, plus the two
// writes the status surface makes itself: queueing a Run and recording a merge/reject decision.
// Both implementations enforce the section 4 semantics notes that are checkable from stored data
// alone (see invariants.ts), so a bad write fails loudly instead of landing in the source of truth.

export interface RunQuery {
  status?: Run["status"];
  /** Defaults to DEFAULT_RUN_LIMIT. */
  limit?: number;
  offset?: number;
}

export interface FindingQuery {
  /** true: only Findings the reproduction step confirmed; false: only unconfirmed ones. */
  reproducible?: boolean;
}

export interface RunUpdate {
  stage?: Run["stage"];
  status?: Run["status"];
}

export interface NewRun {
  target: Run["target"];
  trigger: Run["trigger"];
}

export interface RunCounts {
  findings: number;
  /** Findings with reproducible: true, i.e. confirmed by the reproduction step. */
  reproducible: number;
  diagnoses: number;
  patches: number;
  /** Patches that passed the Verification gate: status verified or merged. */
  verifiedPatches: number;
}

export type PatchDecision = "merge" | "reject";

/** A verified Patch whose PR is open: nobody has merged or closed it yet. */
export interface OpenPullRequest {
  runId: string;
  patch: Patch;
}

/** One entry of a Run's retained prompt and tool-call log (section 9). */
export interface RunLogRecord {
  at: string;
  /** What wrote it: "gemini" for a model interaction, "orchestrator" for a pipeline event. */
  kind: string;
  entry: unknown;
}

export const DEFAULT_RUN_LIMIT = 50;

export type StoreErrorCode = "NOT_FOUND" | "CONFLICT" | "INVALID";

/** Every rejected read or write. `code` maps onto a tRPC error code in the router. */
export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

export interface RunStore {
  readonly kind: "memory" | "mongo";

  // Reads ------------------------------------------------------------------------------------
  /** Newest first (startedAt descending). */
  listRuns(query?: RunQuery): Promise<Run[]>;
  getRun(runId: string): Promise<Run | null>;
  /** Per-run tallies for the given Run IDs; unknown IDs map to all-zero counts. */
  countRuns(runIds: string[]): Promise<Record<string, RunCounts>>;
  /** In insertion order. An unknown runId yields an empty list. */
  listFindings(runId: string, query?: FindingQuery): Promise<Finding[]>;
  getFinding(findingId: string): Promise<Finding | null>;
  listDiagnoses(runId: string): Promise<Diagnosis[]>;
  getDiagnosis(diagnosisId: string): Promise<Diagnosis | null>;
  listPatches(runId: string): Promise<Patch[]>;
  getPatch(patchId: string): Promise<Patch | null>;

  // Writes -----------------------------------------------------------------------------------
  /** Queue a new Run: stage "ingest", status "queued", a fresh ID and logRef. */
  createRun(input: NewRun): Promise<Run>;
  /** Store a fully formed Run (seeded demo data, or a Run another trigger path built). */
  insertRun(run: Run): Promise<Run>;
  /** Move a Run's stage and/or status. Completed and failed Runs are final. */
  updateRun(runId: string, update: RunUpdate): Promise<Run>;
  addFindings(runId: string, findings: Finding[]): Promise<void>;
  /** The reproduction step's result: flips reproducible to true, exactly once. */
  recordReproduction(findingId: string, reproductionOutput?: string): Promise<Finding>;
  addDiagnoses(runId: string, diagnoses: Diagnosis[]): Promise<void>;
  /** Insert or replace a Patch as Repair and Verify produce it. Never sets "merged". */
  savePatch(runId: string, patch: Patch): Promise<Patch>;
  /** A person's merge/reject on a verified Patch: the only way a Patch reaches "merged". */
  setPatchDecision(patchId: string, decision: PatchDecision): Promise<Patch>;
  /** Verified Patches with a `prUrl` that no one has merged or closed yet, in the order stored. */
  listOpenPullRequests(): Promise<OpenPullRequest[]>;

  // Orchestrator ------------------------------------------------------------------------------
  /** The work queue: moves the oldest queued Run to running and returns it, atomically, so two
   *  orchestrators polling at once never take the same Run. Null when nothing is queued. */
  claimNextQueued(): Promise<Run | null>;
  /** Appends to a Run's retained prompt and tool-call log (section 9). */
  appendLog(runId: string, kind: string, entry: unknown, at?: string): Promise<void>;
  /** A Run's log, in write order. */
  listLogs(runId: string, query?: { kind?: string }): Promise<RunLogRecord[]>;

  // Lifecycle --------------------------------------------------------------------------------
  /** Resolves when the backing store is reachable; rejects otherwise. */
  ping(): Promise<void>;
  close(): Promise<void>;
}
