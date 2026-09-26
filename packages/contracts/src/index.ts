import { z } from "zod";

export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export const StageSchema = z.enum(["ingest", "detect", "diagnose", "repair", "verify", "done"]);
export const RunStatusSchema = z.enum(["queued", "running", "blocked", "completed", "failed"]);
export const TriggerSchema = z.enum(["manual", "schedule", "webhook"]);

export const FindingSchema = z.object({
  id: z.string(), detectorId: z.string(), ruleId: z.string(), severity: SeveritySchema,
  category: z.string(), file: z.string(), lineStart: z.number(), lineEnd: z.number(),
  message: z.string(), evidence: z.string(), reproducible: z.boolean().default(false),
  reproductionCommand: z.string().optional(), reproductionOutput: z.string().optional(), createdAt: z.string()
});

export const DiagnosisSchema = z.object({
  id: z.string(), findingIds: z.array(z.string()), rootCause: z.string(), proposedStrategy: z.string(),
  riskNotes: z.string(), model: z.string(), createdAt: z.string()
});

export const PatchSchema = z.object({
  id: z.string(), diagnosisId: z.string(), diff: z.string(), filesChanged: z.array(z.string()),
  testsPassed: z.boolean(), originalFindingReproduces: z.boolean(), reproductionOutputAfter: z.string().optional(),
  regressionFindings: z.array(FindingSchema), challengerVerdict: z.enum(["confirmed", "disputed"]),
  challengerNotes: z.string().optional(), status: z.enum(["proposed", "verified", "rejected", "merged"]),
  prUrl: z.string().url().optional()
});

export const RunSchema = z.object({
  id: z.string(), trigger: TriggerSchema, target: z.object({ kind: z.enum(["local", "github"]), ref: z.string() }),
  stage: StageSchema, status: RunStatusSchema, startedAt: z.string(), logRef: z.string()
});

export const WorkspaceSchema = z.object({
  runId: z.string(), path: z.string(), fileIndex: z.array(z.string()), languages: z.array(z.string()), headCommit: z.string()
});

export const ExecRequestSchema = z.object({ workspacePath: z.string(), command: z.string(), timeoutMs: z.number() });
export const ExecResultSchema = z.object({
  exitCode: z.number(), stdout: z.string(), stderr: z.string(), timedOut: z.boolean(), durationMs: z.number()
});

export type Severity = z.infer<typeof SeveritySchema>;
export type Stage = z.infer<typeof StageSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type Patch = z.infer<typeof PatchSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type ExecRequest = z.infer<typeof ExecRequestSchema>;
export type ExecResult = z.infer<typeof ExecResultSchema>;

export interface DetectorAdapter {
  id: string;
  run(workspace: Workspace, exec: (request: ExecRequest) => Promise<ExecResult>): Promise<Finding[]>;
}
