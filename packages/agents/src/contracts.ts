/**
 * Local mirror of the section 4 contracts (CLAUDE.md), written as Zod schemas.
 *
 * @repro/contracts (Lane 1) has not landed yet. Until it does, this file is Lane 3's only
 * import point for contract types; once it lands, replace this file's body with re-exports
 * from @repro/contracts. It transcribes section 4's types and nothing more: semantic rules
 * (a Diagnosis must cite at least one Finding, and so on) are enforced by the Lane 3 code
 * that produces the objects, not tightened here.
 */
import * as z from "zod";

export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

// Emitted by a DetectorAdapter. No model involvement. Lane 3 treats every Finding as
// read-only input and never sets `reproducible`.
export const FindingSchema = z.object({
  id: z.string(),
  detectorId: z.string(),
  ruleId: z.string(),
  severity: SeveritySchema,
  // "vulnerability" | "inefficiency" | "correctness" | "style" | string
  category: z.string(),
  file: z.string(),
  lineStart: z.number().int(),
  lineEnd: z.number().int(),
  message: z.string(),
  evidence: z.string(),
  reproducible: z.boolean(),
  reproductionCommand: z.string().optional(),
  // Pending at the freeze (section 14).
  reproductionOutput: z.string().optional(),
  createdAt: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const DiagnosisSchema = z.object({
  id: z.string(),
  findingIds: z.array(z.string()),
  rootCause: z.string(),
  proposedStrategy: z.string(),
  riskNotes: z.string(),
  model: z.string(),
  createdAt: z.string(),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const ChallengerVerdictSchema = z.enum(["confirmed", "disputed"]);
export type ChallengerVerdict = z.infer<typeof ChallengerVerdictSchema>;

export const PatchStatusSchema = z.enum(["proposed", "verified", "rejected", "merged"]);
export type PatchStatus = z.infer<typeof PatchStatusSchema>;

export const PatchSchema = z.object({
  id: z.string(),
  diagnosisId: z.string(),
  diff: z.string(),
  filesChanged: z.array(z.string()),
  testsPassed: z.boolean(),
  originalFindingReproduces: z.boolean(),
  // Pending at the freeze (section 14).
  reproductionOutputAfter: z.string().optional(),
  regressionFindings: z.array(FindingSchema),
  challengerVerdict: ChallengerVerdictSchema,
  challengerNotes: z.string().optional(),
  status: PatchStatusSchema,
  prUrl: z.string().optional(),
});
export type Patch = z.infer<typeof PatchSchema>;

export const WorkspaceSchema = z.object({
  runId: z.string(),
  path: z.string(),
  fileIndex: z.array(z.string()),
  languages: z.array(z.string()),
  headCommit: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const ExecRequestSchema = z.object({
  workspacePath: z.string(),
  command: z.string(),
  timeoutMs: z.number(),
});
export type ExecRequest = z.infer<typeof ExecRequestSchema>;

export const ExecResultSchema = z.object({
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  durationMs: z.number(),
});
export type ExecResult = z.infer<typeof ExecResultSchema>;

// Section 4 names `Executor` without spelling out its shape. `exec` matches the contracts
// package and DockerExecutor Lane 2 wrote (see PROGRESS.md). One ExecResult per ExecRequest,
// no streaming.
export interface Executor {
  exec(request: ExecRequest): Promise<ExecResult>;
}

export interface DetectorAdapter {
  id: string;
  run(workspace: Workspace, exec: Executor): Promise<Finding[]>;
}
