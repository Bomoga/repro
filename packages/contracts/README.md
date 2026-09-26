# @repro/contracts

Core data contracts and TypeScript types for the Repro pipeline.

## Schemas

All contracts are defined as Zod schemas in `src/schemas.ts`:

- **Finding** - Emitted by DetectorAdapter; represents a static analysis finding with reproducibility status
- **Diagnosis** - Emitted by diagnosis agent; explains findings and proposes a fix strategy
- **Patch** - Emitted by repair agent; contains a unified diff and verification status
- **Run** - Owns the pipeline execution state; one row per pipeline run
- **Workspace** - Emitted by Ingest; represents the sandboxed target repository
- **ExecRequest / ExecResult** - Request/response for sandboxed command execution
- **DetectorAdapter** - Interface that all scanners (Semgrep, gitleaks, etc.) must implement

## Types

TypeScript types are inferred from Zod schemas and exported in `src/types.ts`:

```typescript
export type { Finding, Diagnosis, Patch, Run, Workspace, ExecRequest, ExecResult };
export type { Executor, IDetectorAdapter };
```

## Usage

```typescript
import {
  FindingSchema,
  type Finding,
  type IDetectorAdapter,
  type Executor,
} from "@repro/contracts";

// Validate data against schemas
const finding = FindingSchema.parse(data);

// Use types for your implementations
class MyDetector implements IDetectorAdapter {
  id = "my-detector";
  async run(workspace: Workspace, exec: Executor): Promise<Finding[]> {
    // ...
  }
}
```

## Key Semantics

### Finding.reproducible

Starts `false` always. Flipped to `true` only by actually running `reproductionCommand` through the Executor and confirming the result demonstrates the issue. If no `reproductionCommand` exists, stays `false` indefinitely.

### Diagnosis.findingIds

Must only cite Finding IDs in the current batch. The diagnosis agent may read surrounding code to write coherent explanations, but nothing outside a cited Finding's locus is authoritative.

### Patch.diff

Standard unified diff, literal output of `git diff`, applies cleanly with `git apply` against `Workspace.headCommit`. Never a natural-language description or full-file replacement.

### Run.stage

Reflects the pipeline stage currently in flight, not the last one completed. A Run showing `"repair"` means Repair is running now.

### Workspace.headCommit

Single source of truth for "what code produced this Finding." If the target moves or new commits land upstream mid-run, this Run keeps working against its own `headCommit`.
