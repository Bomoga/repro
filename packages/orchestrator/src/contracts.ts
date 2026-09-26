// Everything this package takes from @repro/contracts, in one place: the object schemas, and the
// types inferred from them here. Inferring locally means this package only needs the schema values,
// which lane 1's contracts and the approved package on main both export under the same names.
import {
  Diagnosis as DiagnosisSchema,
  Finding as FindingSchema,
  Patch as PatchSchema,
  Run as RunSchema,
  Workspace as WorkspaceSchema,
} from "@repro/contracts";
import type * as z from "zod";

export { DiagnosisSchema, FindingSchema, PatchSchema, RunSchema, WorkspaceSchema };

export type Finding = z.infer<typeof FindingSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type Patch = z.infer<typeof PatchSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;

export type RunStage = Run["stage"];
export type RunTarget = Run["target"];
