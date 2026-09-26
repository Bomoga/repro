# @repro/contracts

The section 4 contracts from `CLAUDE.md`, written as Zod 4 schemas with TypeScript types inferred from them. Every lane depends on this package and on nothing else from another lane.

Section 4 is the spec. Its semantics notes are hard constraints, and the comment above each schema in `src/schemas.ts` restates the one it carries. If this package and section 4 disagree, section 4 is right and the package has a bug.

## Layout

| File | Contents |
|---|---|
| `src/schemas.ts` | Zod schemas, named `<Name>Schema` |
| `src/types.ts` | Types inferred from those schemas, named `<Name>`, plus the `Executor` and `DetectorAdapter` interfaces |
| `src/index.ts` | Re-exports both |
| `test/schemas.test.ts` | Checks that each inferred type equals section 4's interface exactly, and covers the validation rules |

## Exports

| Contract | Schema | Type |
|---|---|---|
| Finding | `FindingSchema` | `Finding` |
| Diagnosis | `DiagnosisSchema` | `Diagnosis` |
| Patch | `PatchSchema` | `Patch` |
| Run | `RunSchema` | `Run` |
| Workspace | `WorkspaceSchema` | `Workspace` |
| ExecRequest | `ExecRequestSchema` | `ExecRequest` |
| ExecResult | `ExecResultSchema` | `ExecResult` |
| Executor | none (behavior, not data) | `Executor` |
| DetectorAdapter | none (behavior, not data) | `DetectorAdapter` |

Field-level enums are exported too: `SeveritySchema`, `ChallengerVerdictSchema`, `PatchStatusSchema`, `RunTriggerSchema`, `RunTargetSchema`, `RunStageSchema`, and `RunStatusSchema`, each with a matching type (`Severity`, `ChallengerVerdict`, and so on). `KNOWN_CATEGORIES` lists the four categories section 4 names; `Finding.category` still accepts any string.

## Usage

```ts
import { FindingSchema, type DetectorAdapter, type Executor, type Finding, type Workspace } from "@repro/contracts";

const finding: Finding = FindingSchema.parse(raw);

export const semgrep: DetectorAdapter = {
  id: "semgrep",
  async run(workspace: Workspace, exec: Executor): Promise<Finding[]> {
    const result = await exec.exec({ workspacePath: workspace.path, command: "semgrep --json .", timeoutMs: 120_000 });
    // Translate result.stdout into Findings. Every one starts with reproducible: false.
    return [];
  },
};
```

Deriving Gemini's structured-output schema from a contract, so the two can't drift:

```ts
import * as z from "zod";
import { DiagnosisSchema } from "@repro/contracts";

const responseSchema = z.toJSONSchema(DiagnosisSchema.pick({ findingIds: true, rootCause: true, proposedStrategy: true, riskNotes: true }));
```

Field descriptions from section 4 are attached with `.describe()`, so they show up in the JSON Schema.

## Calls made at the freeze

- **The two pending fields are not adopted.** `Finding.reproductionOutput` and `Patch.reproductionOutputAfter` are absent. `z.object` strips unknown keys, so parsing an object that carries either one drops it silently.
- **`Executor` is one method, `exec(request: ExecRequest): Promise<ExecResult>`.** Section 4 names `Executor` without giving its shape; this matches the Lane 2 DockerExecutor and the Lane 3 callers.
- **Validation adds only constraints the types already imply.** Line numbers and `exitCode` are integers, `timeoutMs` is a positive integer, `durationMs` is non-negative. Timestamps are ISO 8601 strings by convention, not by validation.
- **Cross-field rules stay out of the schemas.** "A Diagnosis cites at least one Finding" and "`status` only moves forward" are enforced by the code that produces the objects. Every object schema stays a plain `z.object`, so `.shape`, `.pick`, `.extend`, and `z.toJSONSchema` all keep working.

## Changing this package

Every lane builds against it. Per section 6, a change here never merges to `main` on its own: it waits for a human confirmation through Dispatch, and its PR carries one line saying what changed and why.

## Scripts

From the repo root:

```sh
npm install
npm run build   # type-check, including the section 4 type-equality assertions
npm test
```
