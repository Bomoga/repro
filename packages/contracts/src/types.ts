// TypeScript types for the section 4 contracts. Data types are inferred from the Zod schemas in
// schemas.ts, so a type can never drift from the schema that validates it. Executor and
// DetectorAdapter are behavior, not data, so they are plain interfaces.
import type * as z from "zod";
import type {
  ChallengerVerdictSchema,
  DiagnosisSchema,
  ExecRequestSchema,
  ExecResultSchema,
  FindingSchema,
  PatchSchema,
  PatchStatusSchema,
  RunSchema,
  RunStageSchema,
  RunStatusSchema,
  RunTargetSchema,
  RunTriggerSchema,
  SeveritySchema,
  WorkspaceSchema,
} from "./schemas.js";

// ---------------------------------------------------------------------------------------------
// Pipeline data
// ---------------------------------------------------------------------------------------------

export type Severity = z.infer<typeof SeveritySchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type ChallengerVerdict = z.infer<typeof ChallengerVerdictSchema>;
export type PatchStatus = z.infer<typeof PatchStatusSchema>;
export type Patch = z.infer<typeof PatchSchema>;
export type RunTrigger = z.infer<typeof RunTriggerSchema>;
export type RunTarget = z.infer<typeof RunTargetSchema>;
export type RunStage = z.infer<typeof RunStageSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type Run = z.infer<typeof RunSchema>;

// ---------------------------------------------------------------------------------------------
// Execution and ingestion
// ---------------------------------------------------------------------------------------------

export type Workspace = z.infer<typeof WorkspaceSchema>;
export type ExecRequest = z.infer<typeof ExecRequestSchema>;
export type ExecResult = z.infer<typeof ExecResultSchema>;

// The sandboxed command runner every stage that executes target-repo code depends on. Section 4
// names it without spelling out its shape; `exec` is the one method Lane 2's DockerExecutor
// implements and Lane 3 calls. Every call runs inside the ephemeral, network-restricted container
// from section 9. One ExecResult per ExecRequest, no streaming, no partial results.
export interface Executor {
  exec(request: ExecRequest): Promise<ExecResult>;
}

// The interface every wrapped scanner implements. The Detection Engine only ever calls this, never
// a specific tool's CLI directly.
//
// Semantics: an adapter translates a tool's native output into Findings. It does not filter by
// severity or otherwise editorialize (that judgment belongs to Diagnose), and every Finding it
// returns starts with `reproducible: false`, however confident the underlying tool is.
export interface DetectorAdapter {
  /** "semgrep", "gitleaks"; matches Finding.detectorId. */
  id: string;
  run(workspace: Workspace, exec: Executor): Promise<Finding[]>;
}
