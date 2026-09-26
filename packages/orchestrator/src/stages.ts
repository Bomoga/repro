// The stage handler interfaces: the seam between the Run Orchestrator (lane 1) and the stages lane 2
// (Ingest, Detect) and lane 3 (Diagnose, Repair, Verify) implement.
//
// Who does what:
// - A handler does its stage's work and returns what it produced. It never writes to the Run Store
//   and never changes a Run, so lane 2 and lane 3 packages need no dependency on @repro/store.
// - The orchestrator owns the Run (CLAUDE.md section 3). For each stage it reads the input from
//   the store, calls the handler, checks the output against the section 4 and 5 rules, stores it,
//   logs the transition to run_logs, and moves the Run on.
//
// The flow, with what each stage reads and what the orchestrator stores from it:
//
//   ingest    target                         -> Workspace (logged; handed to every later stage)
//   detect    workspace                      -> Findings            (findings collection)
//   diagnose  workspace + the Run's Findings -> Diagnoses           (diagnoses collection)
//   repair    repairable Diagnoses           -> proposed Patches    (patches collection)
//   verify    proposed Patches               -> Challenger verdicts (recorded on each Patch; the
//                                                                    gate then sets verified or rejected)
//
// A Patch the gate rejects goes back to Repair with the rejected attempts attached, until its
// Diagnosis has had `maxRepairAttempts` rounds (section 5: two per Diagnosis, counting the
// verify-to-repair retry). Then the Run moves on to done.
import type { Diagnosis, Finding, Patch, Run, RunStage, RunTarget, Workspace } from "./contracts.js";

/** The stages a handler runs. "done" is where a completed Run ends up, not a stage of work. */
export type StageName = Exclude<RunStage, "done">;

export const STAGE_ORDER = ["ingest", "detect", "diagnose", "repair", "verify"] as const satisfies readonly StageName[];

/**
 * What a handler returns.
 * - `success`: the stage finished; the orchestrator stores `output` and moves on.
 * - `failure`: the stage can't finish; the Run is marked failed and nothing after it runs.
 *   Throwing from `run` means the same thing.
 * - `retry`: a transient problem (a rate limit, a flaky clone); the orchestrator calls the same
 *   stage again with the same input, up to `maxStageAttempts`, then fails the Run.
 */
export type StageResult<T> =
  | { status: "success"; output: T; summary?: string }
  | { status: "failure"; error: string }
  | { status: "retry"; reason: string };

/** A sink with the shape of lane 3's `InteractionLog`, so the Gemini wrapper can write straight to it. */
export interface InteractionSink {
  record(entry: object): void;
}

export interface StageContext {
  /** The Run as stored when this stage started: `stage` is this stage, `status` is "running". */
  readonly run: Run;
  readonly stage: StageName;
  /** 1 on the first call; goes up each time the handler returns `retry`. */
  readonly attempt: number;
  /** Appends a note to this Run's log (run_logs, kind "stage"), tagged with the stage and attempt. */
  log(entry: Record<string, unknown>): Promise<void>;
  /**
   * Where the Gemini wrapper records every prompt and tool call (run_logs, kind "gemini"), so a
   * human can always answer "why did it do that" (section 9). Flushed when the stage call ends.
   */
  readonly interactionLog: InteractionSink;
}

export interface StageHandler<TInput, TOutput> {
  /** True on the placeholder handlers in mocks.ts, so the run log says which stages were simulated. */
  readonly mock?: boolean;
  run(input: TInput, ctx: StageContext): Promise<StageResult<TOutput>>;
}

// ---------------------------------------------------------------------------------------------
// Ingest (lane 2): clone or mount the target into a sandboxed workspace and index it.
// ---------------------------------------------------------------------------------------------

export interface IngestInput {
  runId: string;
  target: RunTarget;
}

/**
 * Returns the Workspace every later stage reads (its `fileIndex` is the file index). Its `runId`
 * must be this Run's. `dispose`, if given, runs once the Run has finished, completed or failed.
 */
export interface IngestHandler extends StageHandler<IngestInput, Workspace> {
  dispose?(workspace: Workspace): void | Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Detect (lane 2): the detector adapters, then the reproduction step. No model calls.
// ---------------------------------------------------------------------------------------------

export interface DetectInput {
  workspace: Workspace;
}

/**
 * The Findings as they stand after the reproduction step. Section 4, checked by the orchestrator:
 * a Finding may be `reproducible: true` only if it has a `reproductionCommand`, and carries
 * `reproductionOutput` only if it is reproducible. IDs must be unique across Runs; deriving them
 * from the Run ID keeps a retried stage idempotent.
 */
export interface DetectOutput {
  findings: Finding[];
}

export type DetectHandler = StageHandler<DetectInput, DetectOutput>;

// ---------------------------------------------------------------------------------------------
// Diagnose (lane 3): explain and group Findings. Never raises an issue no Finding backs.
// ---------------------------------------------------------------------------------------------

export interface DiagnoseInput {
  workspace: Workspace;
  /** Every Finding of this Run, confirmed and unconfirmed, in file order. Never empty. */
  findings: Finding[];
}

/** Every Diagnosis must cite at least one Finding ID, and only IDs from `findings`; the store refuses anything else. */
export interface DiagnoseOutput {
  diagnoses: Diagnosis[];
}

export type DiagnoseHandler = StageHandler<DiagnoseInput, DiagnoseOutput>;

// ---------------------------------------------------------------------------------------------
// Repair (lane 3): one patch attempt per Diagnosis, applied and tested in the sandbox.
// ---------------------------------------------------------------------------------------------

export interface RepairInput {
  workspace: Workspace;
  /** The Diagnoses to repair this round: only those whose cited Findings are all reproducible. Never empty. */
  diagnoses: Diagnosis[];
  /** The Findings those Diagnoses cite. */
  findings: Finding[];
  /**
   * Earlier, rejected attempts at these Diagnoses, oldest first. Why each failed is on the Patch
   * itself: the Challenger's `challengerNotes`, and the deterministic fields `gateFailures` from
   * @repro/store reads. Empty in round 1.
   */
  previousAttempts: Patch[];
  /** 1 for the first attempt, 2 for the retry after a rejection. */
  round: number;
}

/**
 * New Patches, each citing one of `diagnoses`, with status "proposed" (or "rejected" when the
 * repair loop gave up on its own). Only the gate sets "verified" and only a human sets "merged",
 * so the orchestrator refuses either here. The Challenger hasn't run yet: set `challengerVerdict`
 * to "disputed", which fails closed until Verify records the real verdict.
 */
export interface RepairOutput {
  patches: Patch[];
}

export type RepairHandler = StageHandler<RepairInput, RepairOutput>;

// ---------------------------------------------------------------------------------------------
// Verify (lane 3): the adversarial Challenger, then the deterministic gate.
// ---------------------------------------------------------------------------------------------

export interface VerifyInput {
  workspace: Workspace;
  /** This round's proposed Patches. Never empty. */
  patches: Patch[];
  diagnoses: Diagnosis[];
  findings: Finding[];
}

/**
 * The Challenger's verdict on one Patch, plus any deterministic result Verify re-confirmed
 * (section 4: `reproductionOutputAfter` is re-confirmed by Verify). Omitted fields keep what
 * Repair stored.
 */
export type PatchVerdict = { patchId: string } & Pick<Patch, "challengerVerdict"> &
  Partial<Pick<Patch, "challengerNotes" | "testsPassed" | "originalFindingReproduces" | "reproductionOutputAfter" | "regressionFindings">>;

/**
 * One verdict per Patch. Verify never sets `status`: the gate is plain code in the orchestrator
 * (section 5), `verified` only when tests passed, the original Finding no longer reproduces, there
 * are no regression Findings, and the Challenger confirmed. A Patch with no verdict is rejected.
 */
export interface VerifyOutput {
  verdicts: PatchVerdict[];
}

export type VerifyHandler = StageHandler<VerifyInput, VerifyOutput>;

export interface StageHandlers {
  ingest: IngestHandler;
  detect: DetectHandler;
  diagnose: DiagnoseHandler;
  repair: RepairHandler;
  verify: VerifyHandler;
}
