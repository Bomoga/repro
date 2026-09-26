/**
 * Lane 3's view of the section 4 contracts: the approved @repro/contracts package, re-exported
 * under the names Lane 3's code uses (`FindingSchema` for the Zod schema, `Finding` for its
 * type). Nothing is defined here; the package is the single source of truth.
 */
import type * as z from "zod";
import { Diagnosis, ExecRequest, ExecResult, Finding, Patch, Severity, Workspace } from "@repro/contracts";

export type { DetectorAdapter, Diagnosis, ExecRequest, ExecResult, Executor, Finding, Patch, Severity, Workspace } from "@repro/contracts";

export const SeveritySchema = Severity;
export const FindingSchema = Finding;
export const DiagnosisSchema = Diagnosis;
export const PatchSchema = Patch;
export const WorkspaceSchema = Workspace;
export const ExecRequestSchema = ExecRequest;
export const ExecResultSchema = ExecResult;

export const ChallengerVerdictSchema = Patch.shape.challengerVerdict;
export type ChallengerVerdict = z.infer<typeof ChallengerVerdictSchema>;

export const PatchStatusSchema = Patch.shape.status;
export type PatchStatus = z.infer<typeof PatchStatusSchema>;
