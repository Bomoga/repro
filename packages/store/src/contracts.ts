// Everything this package takes from @repro/contracts, in one place. Only the four object schemas
// and their types come from the package; enum values and field types are read off those schemas'
// shapes, so this package doesn't depend on how the contracts package names its smaller exports.
// If the object schemas are ever renamed, this is the only file here that changes. The approved
// package exports each schema under the contract's own name (`Finding` is both the Zod schema and
// its inferred type), so the schemas are aliased to `<Name>Schema` here.
import {
  Diagnosis as DiagnosisSchema,
  Finding as FindingSchema,
  Patch as PatchSchema,
  Run as RunSchema,
} from "@repro/contracts";
import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";

export { DiagnosisSchema, FindingSchema, PatchSchema, RunSchema };
export type { Diagnosis, Finding, Patch, Run };

export type Severity = Finding["severity"];
export type PatchStatus = Patch["status"];
export type RunStage = Run["stage"];
export type RunStatus = Run["status"];
export type RunTarget = Run["target"];
export type RunTrigger = Run["trigger"];

export const ENUMS = {
  severity: FindingSchema.shape.severity.options,
  challengerVerdict: PatchSchema.shape.challengerVerdict.options,
  patchStatus: PatchSchema.shape.status.options,
  runTrigger: RunSchema.shape.trigger.options,
  runTargetKind: RunSchema.shape.target.shape.kind.options,
  runStage: RunSchema.shape.stage.options,
  runStatus: RunSchema.shape.status.options,
} as const;
