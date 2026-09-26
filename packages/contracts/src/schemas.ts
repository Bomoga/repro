// The section 4 contracts from CLAUDE.md, written as Zod schemas. TypeScript types are inferred
// from these in types.ts; the semantics notes in section 4 are the spec, and each schema's
// comment restates the one it carries.
//
// Only what section 4 states is encoded here. Cross-field rules (a Diagnosis cites at least one
// Finding, `status` only moves forward) belong to the code that produces the objects, so every
// object schema stays a plain z.object: `.shape`, `.pick`, `.extend`, and `z.toJSONSchema` all
// work on it, and Gemini's structured-output schemas derive from it without drift.
//
// The two *pending* fields, Finding.reproductionOutput and Patch.reproductionOutputAfter, are
// not adopted. z.object strips unknown keys, so parsing an object that carries either one drops it.
import * as z from "zod";

// ---------------------------------------------------------------------------------------------
// Pipeline data
// ---------------------------------------------------------------------------------------------

export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);

// `category` is open-ended in section 4 ("vulnerability" | ... | string), so the schema is a plain
// string. These are the values section 4 names explicitly.
export const KNOWN_CATEGORIES = ["vulnerability", "inefficiency", "correctness", "style"] as const;

// Emitted by a DetectorAdapter. No model involvement.
//
// Semantics: `reproducible` starts false the moment an adapter emits a Finding, always. Only the
// reproduction step flips it to true, by running `reproductionCommand` through the Executor and
// confirming the result demonstrates the issue; never a detector's own confidence, never Diagnose
// or Repair. With no `reproductionCommand`, it stays false and the Finding is unconfirmed input.
export const FindingSchema = z.object({
  id: z.string(),
  detectorId: z.string().describe('Matches DetectorAdapter.id, e.g. "semgrep", "gitleaks", "custom-ast:null-deref"'),
  ruleId: z.string(),
  severity: SeveritySchema,
  category: z.string().describe('"vulnerability" | "inefficiency" | "correctness" | "style", or any other string'),
  file: z.string().describe("Path relative to Workspace.path"),
  lineStart: z.number().int(),
  lineEnd: z.number().int(),
  message: z.string(),
  evidence: z.string().describe("Exact snippet the claim is grounded in"),
  reproducible: z
    .boolean()
    .describe("False when emitted; only the reproduction step, via the Executor, sets it to true"),
  reproductionCommand: z.string().optional(),
  createdAt: z.string().describe("ISO 8601 timestamp"),
});

// Emitted by the diagnosis agent. Must cite Finding IDs; nothing else is legal.
//
// Semantics: `rootCause` and `proposedStrategy` describe only what is true of the Findings in
// `findingIds`: their evidence, file locations, and messages. Surrounding code may inform the
// explanation but is never authoritative, and no new issue is introduced here; a new issue is a
// new Finding, produced by Detect.
export const DiagnosisSchema = z.object({
  id: z.string(),
  findingIds: z.array(z.string()).describe("IDs of the Findings this Diagnosis explains"),
  rootCause: z.string(),
  proposedStrategy: z.string(),
  riskNotes: z.string(),
  model: z.string().describe('Exact model ID that produced it, e.g. "gemini-3.1-pro-preview", never a friendly name'),
  createdAt: z.string().describe("ISO 8601 timestamp"),
});

export const ChallengerVerdictSchema = z.enum(["confirmed", "disputed"]);

export const PatchStatusSchema = z.enum(["proposed", "verified", "rejected", "merged"]);

// Emitted by the repair agent, judged by the Verification / Challenger Gate.
//
// Semantics: `diff` is a standard unified diff, the literal output of `git diff`, applying cleanly
// with `git apply` against Workspace.headCommit; never prose, never a full-file replacement.
// `status` only advances proposed -> verified -> merged, or terminates at rejected. Only the
// Verification / Challenger Gate sets `verified`; only a human merging the PR sets `merged`.
export const PatchSchema = z.object({
  id: z.string(),
  diagnosisId: z.string(),
  diff: z.string().describe("Unified diff: the literal output of `git diff` against Workspace.headCommit"),
  filesChanged: z.array(z.string()),
  testsPassed: z.boolean(),
  originalFindingReproduces: z.boolean().describe("false means the original Finding is confirmed fixed"),
  regressionFindings: z.array(FindingSchema).describe("New Findings the patch introduced; should be empty"),
  challengerVerdict: ChallengerVerdictSchema,
  challengerNotes: z.string().optional(),
  status: PatchStatusSchema,
  prUrl: z.string().optional(),
});

export const RunTriggerSchema = z.enum(["manual", "schedule", "webhook"]);

export const RunTargetSchema = z.object({
  kind: z.enum(["local", "github"]),
  ref: z.string(),
});

export const RunStageSchema = z.enum(["ingest", "detect", "diagnose", "repair", "verify", "done"]);

export const RunStatusSchema = z.enum(["queued", "running", "blocked", "completed", "failed"]);

// Owned by the Run Orchestrator. One row per pipeline execution.
//
// Semantics: `stage` is the pipeline stage currently in flight, not the last one completed; a Run
// showing "repair" means Repair is running now.
export const RunSchema = z.object({
  id: z.string(),
  trigger: RunTriggerSchema,
  target: RunTargetSchema,
  stage: RunStageSchema.describe("The stage currently in flight, not the last one completed"),
  status: RunStatusSchema,
  startedAt: z.string().describe("ISO 8601 timestamp"),
  logRef: z.string(),
});

// ---------------------------------------------------------------------------------------------
// Execution and ingestion
// ---------------------------------------------------------------------------------------------

// Emitted by Ingest. Everything downstream reads from this; nothing touches the target repo's
// original location again once it exists.
//
// Semantics: `headCommit` is the single source of truth for what code produced a Finding. If the
// target moves mid-run, this Run keeps working against its own `headCommit`. `fileIndex` is a
// snapshot taken at ingest time; Detect does not re-walk the tree.
export const WorkspaceSchema = z.object({
  runId: z.string(),
  path: z.string().describe("Sandbox-local path to the cloned or mounted code"),
  fileIndex: z.array(z.string()).describe("Every tracked file's path, relative to `path`, snapshotted at ingest"),
  languages: z.array(z.string()).describe('Detected languages present, e.g. ["typescript", "python"]'),
  headCommit: z.string().describe("The exact commit the rest of the run is judged against"),
});

// Input to the Executor, the sandboxed command runner.
export const ExecRequestSchema = z.object({
  workspacePath: z.string().describe("From Workspace.path"),
  command: z.string(),
  timeoutMs: z.number().int().positive(),
});

// Output of the Executor.
//
// Semantics: every invocation runs inside the ephemeral, network-restricted container from
// section 9. A non-zero `exitCode` is not a failure signal for the Executor to interpret; the
// caller decides what its own command's exit codes mean. One ExecResult per ExecRequest, no
// streaming, no partial results.
export const ExecResultSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  durationMs: z.number().nonnegative(),
});
