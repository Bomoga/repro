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

export { Diagnosis as DiagnosisSchema, Finding as FindingSchema, Patch as PatchSchema, Run as RunSchema };

export type Finding = z.infer<typeof Finding>;
export type Diagnosis = z.infer<typeof Diagnosis>;
export type Patch = z.infer<typeof Patch>;
export type Run = z.infer<typeof Run>;

export type Severity = Finding["severity"];
export type PatchStatus = Patch["status"];
export type RunStage = Run["stage"];
export type RunStatus = Run["status"];
export type RunTarget = Run["target"];
export type RunTrigger = Run["trigger"];

export const ENUMS = {
  severity: Finding.shape.severity.options,
  challengerVerdict: Patch.shape.challengerVerdict.options,
  patchStatus: Patch.shape.status.options,
  runTrigger: Run.shape.trigger.options,
  runTargetKind: Run.shape.target.shape.kind.options,
  runStage: Run.shape.stage.options,
  runStatus: Run.shape.status.options,
} as const;
