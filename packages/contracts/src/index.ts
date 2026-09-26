// @repro/contracts: the section 4 contracts from CLAUDE.md, written as Zod schemas with the
// TypeScript types inferred from them.
//
// Lane 1's own @repro/contracts package hadn't landed on main by the time Lane 4 (status
// surface: API/CLI/web) needed it, and Lane 2 had already published a compatible version on its
// own branch (unmerged) with the same two adopted calls noted below. This is a mirror of that,
// kept field-for-field identical so it merges cleanly once Lane 1 or Lane 2 lands on main —
// at that point this package's body should become re-exports from theirs.
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

export const ExecResult = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  durationMs: z.number(),
});
export type ExecResult = z.infer<typeof ExecResult>;

export interface Executor {
  exec(request: ExecRequest): Promise<ExecResult>;
}

export interface DetectorAdapter {
  id: string;
  run(workspace: Workspace, exec: Executor): Promise<Finding[]>;
}
