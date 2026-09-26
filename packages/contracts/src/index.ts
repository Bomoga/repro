/**
 * @repro/contracts - Data contracts and core types for Repro
 *
 * This package exports all Zod schemas and TypeScript types that define
 * the core data contracts for the Repro pipeline:
 * - Finding: Emitted by DetectorAdapter
 * - Diagnosis: Emitted by diagnosis agent
 * - Patch: Emitted by repair agent
 * - Run: Orchestrator state
 * - Workspace: Ingest output
 * - Executor interfaces for sandboxed execution
 * - DetectorAdapter interface
 */

// Export all schemas
export {
  FindingSchema,
  DiagnosisSchema,
  PatchSchema,
  RunSchema,
  WorkspaceSchema,
  ExecRequestSchema,
  ExecResultSchema,
  DetectorAdapterSchema,
} from "./schemas";

// Export all types
export type {
  Finding,
  Diagnosis,
  Patch,
  Run,
  Workspace,
  ExecRequest,
  ExecResult,
} from "./types";

export type { Executor, IDetectorAdapter } from "./types";
