/**
 * Type definitions for Repro contracts.
 * These are inferred from Zod schemas defined in schemas.ts, plus the DetectorAdapter
 * interface which includes runtime functions.
 */

import {
  Finding,
  Diagnosis,
  Patch,
  Run,
  Workspace,
  ExecRequest,
  ExecResult,
  DetectorAdapter,
} from "./schemas";

/**
 * Re-export inferred types from schemas
 */
export type { Finding, Diagnosis, Patch, Run, Workspace, ExecRequest, ExecResult };

/**
 * Executor - The sandboxed command runner that every stage running target-repo code
 * depends on. Interface for the container execution abstraction.
 */
export interface Executor {
  run(request: ExecRequest): Promise<ExecResult>;
}

/**
 * DetectorAdapter - Every wrapped scanner implements this interface.
 * Semantics: An adapter translates a tool's native output into Finding objects.
 * Every Finding an adapter returns starts with reproducible: false.
 */
export interface IDetectorAdapter extends DetectorAdapter {
  run(workspace: Workspace, exec: Executor): Promise<Finding[]>;
}
