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

## How the Run Store keeps these contracts

The Run Store (section 10) is MongoDB Atlas, reached through `@repro/store`. Each contract is stored as it is: one collection per contract, one contract object per document, no field renamed or reshaped. `packages/store/README.md` covers the API; this section is the storage spec.

### Collections

| Collection | One document per | Storage-only fields | Written by | Read by |
|---|---|---|---|---|
| `runs` | `Run` | none | Run Orchestrator | CLI, API, dashboard |
| `findings` | `Finding` | `runId` | Detect; the reproduction step flips `reproducible` | Diagnose, Repair, Challenger, Trust Report |
| `diagnoses` | `Diagnosis` | `runId` | Diagnose | Repair, Challenger, status surface |
| `patches` | `Patch`, with `regressionFindings` embedded as full `Finding` objects | `runId` | Repair and the Verify gate; the status surface records the human's merge or reject | Status surface, PR narrator |
| `run_logs` | Prompt or tool-call record (section 9) | `runId`, `at`, `kind`, `entry` | The Gemini wrapper, through a writer the orchestrator hands it | Anyone asking "why did it do that" |

- **`id` is the contract's own string ID,** generated upstream, and carries a unique index. Mongo's `_id` and the storage-only `runId` never leave the store: every read is parsed with the schemas in this package, so it comes back as exactly the contract.
- **`runId` ties a document to its Run.** Findings, Diagnoses, and Patches don't carry it in section 4, so the store adds it on write and strips it on read. An `id` is unique across all Runs, not just within one.
- **Every write is parsed with these schemas first.** The Mongoose schemas are `strict: "throw"`, so if a contract gains a field and `packages/store/src/models.ts` doesn't, writes fail instead of Mongo dropping the field. `packages/store/test/models.test.ts` checks the same without a database. A change to a contract here updates `models.ts` in the same PR. If the two pending fields are adopted, that means adding `reproductionOutput` to findings and `reproductionOutputAfter` to patches (and to the embedded Finding).
- **Enum values come from these schemas.** The Mongoose schemas read them off `FindingSchema`, `PatchSchema`, and `RunSchema`, so they can't drift.
- **Timestamps stay ISO 8601 strings,** as the contracts have them. Lists sort on them, so write them with `toISOString()`: UTC, ending in `Z`, which sorts in time order as a plain string.
- **`Run.logRef` is `run_logs/<runId>`:** the `run_logs` documents with that `runId`, in write order. One document per entry, so a long repair loop never pushes a single document toward Mongo's 16 MB limit.
- **No deletes, transactions, or aggregation pipelines.** The store is an audit trail, and section 13 keeps it flat.

### Indexes

| Collection | Index | Serves |
|---|---|---|
| `runs` | `{ id: 1 }`, unique | Lookup by ID |
| `runs` | `{ status: 1, startedAt: -1 }` | Runs in one status, newest first; the orchestrator claiming the oldest queued Run |
| `runs` | `{ startedAt: -1 }` | Every Run, newest first (`repro status`) |
| `runs` | `{ stage: 1, status: 1 }` | Runs in a given stage right now; resuming after an orchestrator restart |
| `findings` | `{ id: 1 }`, unique | Lookup by ID |
| `findings` | `{ runId: 1, file: 1, lineStart: 1 }` | A Run's Findings in file order; any query on `runId` alone |
| `findings` | `{ runId: 1, reproducible: 1 }` | Confirmed vs. unconfirmed: demo beat 2's count, and what may go on to Repair |
| `findings` | `{ runId: 1, detectorId: 1 }` | The Trust Report's `privacy-patterns` and gitleaks Findings |
| `diagnoses` | `{ id: 1 }`, unique | Lookup by ID |
| `diagnoses` | `{ runId: 1, createdAt: 1 }` | A Run's Diagnoses in order |
| `diagnoses` | `{ findingIds: 1 }`, multikey | The Diagnoses citing a given Finding |
| `patches` | `{ id: 1 }`, unique | Lookup by ID |
| `patches` | `{ runId: 1, status: 1 }` | A Run's Patches, or just its verified one |
| `patches` | `{ diagnosisId: 1 }` | Attempts per Diagnosis, which section 5 caps at two |
| `patches` | `{ status: 1, _id: -1 }` | Verified Patches across all Runs waiting on a human merge |
| `run_logs` | `{ runId: 1, _id: 1 }` | A Run's log in write order |

`@repro/store` builds these on connect. `npm run check -w @repro/store` builds them explicitly and is safe to repeat.

### Semantics the store enforces on write

A semantics note above is a hard constraint. The store can't see who's calling, but it refuses any write that would break a rule it can check:

| Rule (section) | What the store refuses |
|---|---|
| `reproducible` only ever flips to true, through `reproductionCommand` (4) | Setting it back to false (there is no call for it); flipping a Finding that has no `reproductionCommand` |
| A Diagnosis must cite Finding IDs, nothing else (4, 5) | A Diagnosis citing no Findings, or an ID that isn't a Finding of the same Run; the whole batch is refused, before anything is written |
| A Diagnosis moves on to Repair only if every Finding it cites is reproducible (5) | Nothing is refused; `diagnoses.listRepairable(runId)` returns only the eligible ones |
| `status` only advances `proposed` → `verified` → `merged`, or ends at `rejected` (4) | Any other move, including a second merge; the check and the write are one atomic update |
| Only the gate sets `verified`, and only when all four inputs hold (5) | `verified` unless `testsPassed`, `!originalFindingReproduces`, no `regressionFindings`, and `challengerVerdict: "confirmed"` |
| Only a human merging the PR sets `merged` (4) | Storing a new Patch as `merged` |
| `stage` is the stage in flight (4) | Moving a completed or failed Run at all; `complete` sets stage `done`, and `fail` leaves `stage` where it failed |

### Open questions for the Run Store

- **A diff that removes a secret still contains it.** gitleaks' `--redact` keeps secrets out of Findings, but `Patch.diff` is the literal `git diff`, so a patch that deletes a hardcoded key carries the deleted line into the Run Store. Section 9 says a secret never reaches the Run Store; the diff contract says `diff` is verbatim. The store stores the diff as given until someone decides which rule gives way.

## Changing this package

Every lane builds against it. Per section 6, a change here never merges to `main` on its own: it waits for a human confirmation through Dispatch, and its PR carries one line saying what changed and why.

## Scripts

From the repo root:

```sh
npm install
npm run build   # type-check, including the section 4 type-equality assertions
npm test
```
