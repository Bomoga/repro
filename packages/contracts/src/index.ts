// @repro/contracts: the section 4 contracts from CLAUDE.md, written as Zod schemas with the
// TypeScript types inferred from them. Field names and semantics match section 4 exactly; the
// semantics notes there are the spec, the comments here only point at them.
//
// Written by lane 2 because lane 1 hadn't published the package yet. Two calls made here that
// lane 1 should reconcile:
//   - The two *pending* proof fields (Finding.reproductionOutput, Patch.reproductionOutputAfter)
//     are adopted, as optional fields.
//   - Executor, which section 4 names but never spells out, is one method: exec(ExecRequest).
import * as z from "zod";

// ---------------------------------------------------------------------------------------------
// Pipeline data
// ---------------------------------------------------------------------------------------------

export const Severity = z.enum(["info", "low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof Severity>;

// `category` is open-ended in section 4 ("vulnerability" | ... | string), so the schema is a
// plain string; these are the values the contract names explicitly.
export const KNOWN_CATEGORIES = ["vulnerability", "inefficiency", "correctness", "style"] as const;

// Emitted by a DetectorAdapter. No model involvement.
//
// Semantics: `reproducible` starts false, always, and only the reproduction step flips it, by
// running `reproductionCommand` through the Executor. `reproductionOutput` (pending, adopted) is
// the verbatim ExecResult excerpt that flipped it: written by the reproduction step and nothing
// else, never edited afterward, absent whenever `reproducible` is false.
export const Finding = z.object({
  id: z.string(),
  detectorId: z.string(),
  ruleId: z.string(),
  severity: Severity,
  category: z.string(),
  file: z.string(),
  lineStart: z.number().int(),
  lineEnd: z.number().int(),
  message: z.string(),
  evidence: z.string(),
  reproducible: z.boolean(),
  reproductionCommand: z.string().optional(),
  reproductionOutput: z.string().optional(),
  createdAt: z.string(),
});
export type Finding = z.infer<typeof Finding>;

// Emitted by the diagnosis agent. Must cite Finding IDs; nothing else is legal.
export const Diagnosis = z.object({
  id: z.string(),
  findingIds: z.array(z.string()),
  rootCause: z.string(),
  proposedStrategy: z.string(),
  riskNotes: z.string(),
  model: z.string(),
  createdAt: z.string(),
});
export type Diagnosis = z.infer<typeof Diagnosis>;

// Emitted by the repair agent, judged by the Verification / Challenger Gate.
//
// Semantics: `diff` is the literal output of `git diff` against Workspace.headCommit. `status`
// only advances proposed -> verified -> merged, or terminates at rejected.
// `reproductionOutputAfter` (pending, adopted) comes from the Executor, never from a model.
export const Patch = z.object({
  id: z.string(),
  diagnosisId: z.string(),
  diff: z.string(),
  filesChanged: z.array(z.string()),
  testsPassed: z.boolean(),
  originalFindingReproduces: z.boolean(),
  reproductionOutputAfter: z.string().optional(),
  regressionFindings: z.array(Finding),
  challengerVerdict: z.enum(["confirmed", "disputed"]),
  challengerNotes: z.string().optional(),
  status: z.enum(["proposed", "verified", "rejected", "merged"]),
  prUrl: z.string().optional(),
});
export type Patch = z.infer<typeof Patch>;

// Owned by the Run Orchestrator. One row per pipeline execution.
//
// Semantics: `stage` is the stage currently in flight, not the last one completed.
export const Run = z.object({
  id: z.string(),
  trigger: z.enum(["manual", "schedule", "webhook"]),
  target: z.object({
    kind: z.enum(["local", "github"]),
    ref: z.string(),
  }),
  stage: z.enum(["ingest", "detect", "diagnose", "repair", "verify", "done"]),
  status: z.enum(["queued", "running", "blocked", "completed", "failed"]),
  startedAt: z.string(),
  logRef: z.string(),
});
export type Run = z.infer<typeof Run>;

// ---------------------------------------------------------------------------------------------
// Execution and ingestion
// ---------------------------------------------------------------------------------------------

// Emitted by Ingest. Everything downstream reads from this.
//
// Semantics: `headCommit` is the single source of truth for what code produced a Finding; the
// run never picks up a newer upstream commit. `fileIndex` is a snapshot taken at ingest time.
export const Workspace = z.object({
  runId: z.string(),
  path: z.string(),
  fileIndex: z.array(z.string()),
  languages: z.array(z.string()),
  headCommit: z.string(),
});
export type Workspace = z.infer<typeof Workspace>;

export const ExecRequest = z.object({
  workspacePath: z.string(),
  command: z.string(),
  timeoutMs: z.number().int().positive(),
});
export type ExecRequest = z.infer<typeof ExecRequest>;

// Semantics: one ExecResult per ExecRequest, no streaming, no partial results. A non-zero
// exitCode is not a failure signal for the Executor; the caller interprets its own exit codes.
export const ExecResult = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  durationMs: z.number(),
});
export type ExecResult = z.infer<typeof ExecResult>;

// The sandboxed command runner. Every invocation runs inside the ephemeral, network-restricted
// container from section 9, never on the host.
export interface Executor {
  exec(request: ExecRequest): Promise<ExecResult>;
}

// The interface every wrapped scanner implements. The Detection Engine only ever calls this.
//
// Semantics: an adapter translates native tool output into Findings without filtering by
// severity or editorializing, and every Finding it returns starts with `reproducible: false`.
export interface DetectorAdapter {
  id: string;
  run(workspace: Workspace, exec: Executor): Promise<Finding[]>;
}

// ---------------------------------------------------------------------------------------------
// Run report and analytics (Lane 5)
// ---------------------------------------------------------------------------------------------

// Append-only event log. Every stage emits events at key moments (timestamps, completions, etc).
// Never edited, never free text. Prompts and evidence stay in Run.logRef, referenced by offset.
export const RunEvent = z.object({
  id: z.string(),
  runId: z.string(),
  kind: z.enum([
    "ingest_started",
    "ingest_complete",
    "detect_started",
    "detect_complete",
    "diagnose_started",
    "diagnose_complete",
    "repair_started",
    "repair_attempt",
    "repair_complete",
    "verify_started",
    "verify_complete",
    "finding_reproduced",
    "patch_verified",
    "patch_rejected",
    "patch_merged",
  ]),
  at: z.string(), // ISO 8601
  data: z.record(z.string(), z.any()).optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;

// Computed analytics report: every stat is deterministic from Run + events + findings/patches.
// No model output in any number. Optional model-written summary, dropped if it cites unpublished stats.
export const RunReport = z.object({
  runId: z.string(),
  generatedAt: z.string(),
  stats: z.object({
    rawFindings: z.number().int(),
    reproducedFindings: z.number().int(),
    noiseCut: z.number().int(), // raw - reproduced
    findingsIntoRepair: z.number().int(),
    patchesAttempted: z.number().int(),
    patchesVerified: z.number().int(),
    challengerDisputes: z.number().int(),
    patchesMerged: z.number().int(),
    regressionsFound: z.number().int(),
    successRate: z.number(), // patchesVerified / patchesAttempted, 0..1
    totalDurationMs: z.number().int(),
    avgTimePerStageMs: z.record(z.string(), z.number().int()),
    estimatedCostPerFix: z.number(), // USD
  }),
  findings: z.array(
    z.object({
      id: z.string(),
      severity: Severity,
      message: z.string(),
      file: z.string(),
      lineStart: z.number().int(),
      reproducible: z.boolean(),
      diagnosedAt: z.string().optional(),
      patchedAt: z.string().optional(),
      verifiedAt: z.string().optional(),
      mergedAt: z.string().optional(),
      status: z.enum(["detected", "reproduced", "diagnosed", "repaired", "verified", "merged", "rejected"]),
    })
  ),
});
export type RunReport = z.infer<typeof RunReport>;
