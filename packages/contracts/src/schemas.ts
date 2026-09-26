import { z } from "zod";

/**
 * Finding - Emitted by a DetectorAdapter. No model involvement.
 * Semantics: reproducible starts false; flipped to true only by running reproductionCommand
 * through Executor and confirming the result demonstrates the issue.
 */
export const FindingSchema = z.object({
  id: z.string(),
  detectorId: z.string(), // "semgrep", "gitleaks", "custom-ast:null-deref"
  ruleId: z.string(),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  category: z.string(), // "vulnerability" | "inefficiency" | "correctness" | "style" | string
  file: z.string(), // path relative to Workspace.path
  lineStart: z.number(),
  lineEnd: z.number(),
  message: z.string(),
  evidence: z.string(), // exact snippet the claim is grounded in
  reproducible: z.boolean(), // starts false, flipped to true only by Executor confirmation
  reproductionCommand: z.string().optional(),
  createdAt: z.string(), // ISO 8601
});

export type Finding = z.infer<typeof FindingSchema>;

/**
 * Diagnosis - Emitted by the diagnosis agent. Must cite Finding IDs; nothing else is legal.
 * Semantics: rootCause and proposedStrategy may only describe what's true of Findings in
 * findingIds. The diagnosis agent may read surrounding code but nothing outside a cited
 * Finding's locus is authoritative.
 */
export const DiagnosisSchema = z.object({
  id: z.string(),
  findingIds: z.array(z.string()),
  rootCause: z.string(),
  proposedStrategy: z.string(),
  riskNotes: z.string(),
  model: z.string(), // exact model ID that produced it, e.g. "gemini-3.1-pro-preview"
  createdAt: z.string(), // ISO 8601
});

export type Diagnosis = z.infer<typeof DiagnosisSchema>;

/**
 * Patch - Emitted by the repair agent, judged by Verification / Challenger Gate.
 * Semantics: diff is standard unified diff, literal output of git diff, applies cleanly
 * with git apply against Workspace.headCommit. Status advances proposed → verified → merged
 * or terminates at rejected.
 */
export const PatchSchema = z.object({
  id: z.string(),
  diagnosisId: z.string(),
  diff: z.string(), // unified diff, output of git diff
  filesChanged: z.array(z.string()),
  testsPassed: z.boolean(),
  originalFindingReproduces: z.boolean(), // false == confirmed fixed
  regressionFindings: z.array(FindingSchema),
  challengerVerdict: z.enum(["confirmed", "disputed"]),
  challengerNotes: z.string().optional(),
  status: z.enum(["proposed", "verified", "rejected", "merged"]),
  prUrl: z.string().optional(),
});

export type Patch = z.infer<typeof PatchSchema>;

/**
 * Run - Owned by the Run Orchestrator. One row per pipeline execution.
 * Semantics: stage reflects the pipeline stage currently in flight, not the last one
 * completed. A Run showing "repair" means Repair is running now.
 */
export const RunSchema = z.object({
  id: z.string(),
  trigger: z.enum(["manual", "schedule", "webhook"]),
  target: z.object({
    kind: z.enum(["local", "github"]),
    ref: z.string(),
  }),
  stage: z.enum(["ingest", "detect", "diagnose", "repair", "verify", "done"]),
  status: z.enum(["queued", "running", "blocked", "completed", "failed"]),
  startedAt: z.string(), // ISO 8601
  logRef: z.string(),
});

export type Run = z.infer<typeof RunSchema>;

/**
 * Workspace - Emitted by Ingest. Everything downstream reads from this; nothing touches
 * the target repo's original location again once it exists.
 * Semantics: headCommit is the single source of truth for "what code produced this Finding."
 * fileIndex is a snapshot taken at ingest time.
 */
export const WorkspaceSchema = z.object({
  runId: z.string(),
  path: z.string(), // sandbox-local path to the cloned/mounted code
  fileIndex: z.array(z.string()), // every tracked file's path, relative to path
  languages: z.array(z.string()), // detected languages, e.g. ["typescript", "python"]
  headCommit: z.string(), // exact commit this Run is judged against
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

/**
 * ExecRequest - Input to the sandboxed command runner
 */
export const ExecRequestSchema = z.object({
  workspacePath: z.string(), // from Workspace.path
  command: z.string(),
  timeoutMs: z.number(),
});

export type ExecRequest = z.infer<typeof ExecRequestSchema>;

/**
 * ExecResult - Output from the sandboxed command runner
 * Semantics: One ExecResult per ExecRequest, no streaming. A non-zero exitCode is
 * not itself a failure signal for Executor; the caller decides what its own command's
 * exit codes mean.
 */
export const ExecResultSchema = z.object({
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  durationMs: z.number(),
});

export type ExecResult = z.infer<typeof ExecResultSchema>;

/**
 * DetectorAdapter - Interface every wrapped scanner implements
 * Semantics: An adapter translates a tool's native output into Finding objects.
 * Every Finding an adapter returns starts with reproducible: false.
 */
export const DetectorAdapterSchema = z.object({
  id: z.string(), // "semgrep", "gitleaks"; matches Finding.detectorId
  // run() function is not part of the schema, but defined in the interface
});

export type DetectorAdapter = z.infer<typeof DetectorAdapterSchema>;
