// Everything this package takes from @repro/contracts, in one place: the object schemas and their
// types. The approved package exports each contract under its own name as both the Zod schema and
// its inferred type, so the schemas are aliased to `<Name>Schema` here and the types re-exported as
// they are, the same way @repro/store's contracts.ts does it.
import {
  Diagnosis as DiagnosisSchema,
  Finding as FindingSchema,
  Patch as PatchSchema,
  Run as RunSchema,
  Workspace as WorkspaceSchema,
} from "@repro/contracts";
import type { Diagnosis, Finding, Patch, Run, Workspace } from "@repro/contracts";

export { DiagnosisSchema, FindingSchema, PatchSchema, RunSchema, WorkspaceSchema };
export type { Diagnosis, Finding, Patch, Run, Workspace };

export type RunStage = Run["stage"];
export type RunTarget = Run["target"];
