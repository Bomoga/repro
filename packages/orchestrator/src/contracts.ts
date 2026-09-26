// Everything this package takes from @repro/contracts, in one place: the object schemas, and the
// types inferred from them here. Inferring locally means this package only needs the schema values,
// which lane 1's contracts and the approved package on main both export under the same names.
import { Diagnosis, Finding, Patch, Run, Workspace } from "@repro/contracts";
import type * as z from "zod";

export {
  Diagnosis as DiagnosisSchema,
  Finding as FindingSchema,
  Patch as PatchSchema,
  Run as RunSchema,
  Workspace as WorkspaceSchema,
};

export type Finding = z.infer<typeof Finding>;
export type Diagnosis = z.infer<typeof Diagnosis>;
export type Patch = z.infer<typeof Patch>;
export type Run = z.infer<typeof Run>;
export type Workspace = z.infer<typeof Workspace>;

export type RunStage = Run["stage"];
export type RunTarget = Run["target"];
