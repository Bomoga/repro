# @repro/store

The Run Store from `CLAUDE.md` sections 3 and 10: MongoDB Atlas collections for Runs, Findings, Diagnoses, and Patches, plus each Run's retained prompt and tool-call log. It is the single source of truth for the CLI, the dashboard, and GitHub Checks.

The collections, indexes, and the rules enforced on every write are specified in [`packages/contracts/README.md`](../contracts/README.md#how-the-run-store-keeps-these-contracts). This file covers how to use the package.

## Setup

Export `MONGODB_URI` (Lane 1 hands it out; [ENVIRONMENT.md](../../ENVIRONMENT.md#mongodb-atlas) covers setting up the cluster), then:

```sh
npm run check -w @repro/store
```

That connects, builds every index, prints how many documents each collection holds, and never writes a document. The connection string is only ever printed redacted.

## Usage

```ts
import { connectStore } from "@repro/store";

const store = await connectStore(); // reads MONGODB_URI

// Orchestrator
const run = await store.runs.create({ target: { kind: "local", ref: "./demo-repo" }, trigger: "manual" });
const next = await store.runs.claimNextQueued(); // oldest queued Run, now running; null if none
await store.runs.setStage(run.id, "detect");

// Detect, then the reproduction step
await store.findings.insert(run.id, findings);
await store.findings.markReproducible(findingId); // only after the Executor demonstrated the issue

// Diagnose, then Repair on what's eligible
await store.diagnoses.insert(run.id, diagnoses); // refused if any citation isn't a Finding of this Run
const eligible = await store.diagnoses.listRepairable(run.id);

// Repair and the gate: one Patch per attempt
await store.patches.insert(run.id, patch);
await store.patches.transition(patch.id, "verified"); // refused unless the gate's four inputs hold

// Status surface: the human's decision, and the PR
await store.patches.setPrUrl(patch.id, prUrl);
await store.patches.transition(patch.id, "merged"); // or "rejected"

await store.runs.complete(run.id); // stage "done", status "completed"; or runs.fail(run.id)
```

Every read returns exactly the section 4 contract, parsed with `@repro/contracts`; `_id` and `runId` never come back. Every write is parsed first, so a malformed object throws a `ZodError` before Mongo sees it.

### Retaining the run log

Section 9 requires every Run's full prompt and tool-call log in the Run Store. `store.logs.writer(runId)` returns a synchronous `record(entry)` sink, the same shape as Lane 3's `InteractionLog`, so it goes straight into the Gemini wrapper:

```ts
const log = store.logs.writer(run.id);
const gemini = createGeminiClient({ log });
// ...run the stage...
await log.flush(); // waits for the background writes; rethrows the first one that failed
const entries = await store.logs.list(run.id);
```

## Query helpers

| Collection | Helper | Notes |
|---|---|---|
| runs | `create`, `insert`, `get`, `list({ status, stage, limit })` | `create` starts a Run at `ingest`/`queued` with `logRef` set; lists are newest first |
| runs | `claimNextQueued()` | Atomic, so two orchestrators polling at once never claim the same Run |
| runs | `setStage`, `setStatus`, `complete`, `fail` | Only while queued, running, or blocked; a finished Run never changes |
| findings | `insert(runId, findings)`, `get`, `getMany`, `list(runId, filters)` | Filters: `reproducible`, `detectorId`, `severity`, `category`; file order |
| findings | `markReproducible(id)`, `counts(runId)` | `counts` gives `{ total, reproducible }`, demo beat 2's two numbers |
| diagnoses | `insert(runId, diagnoses)`, `get`, `list`, `citing(findingId)`, `listRepairable(runId)` | |
| patches | `insert(runId, patch)`, `get`, `list(runId, { status })`, `listByDiagnosis`, `listByStatus` | `listByStatus("verified")` is the merge queue |
| patches | `transition(id, to)`, `setPrUrl(id, url)` | `gateFailures(patch)` and `PATCH_TRANSITIONS` are exported for reuse |
| run_logs | `append`, `list(runId)`, `writer(runId)` | |

Batch inserts are idempotent: re-sending an object whose `id` is already stored for that Run leaves the stored one untouched and counts it in `alreadyPresent`, so an orchestrator retrying after a timeout can't undo a `reproducible` flip. Reusing an `id` under a different Run fails on the unique index.

### Lane 4's `RunStore` interface

| Lane 4 (`packages/api/src/store.ts`) | `@repro/store` |
|---|---|
| `createRun`, `listRuns`, `getRun` | `runs.create`, `runs.list`, `runs.get` |
| `listFindings`, `listDiagnoses`, `listPatches` | `findings.list`, `diagnoses.list`, `patches.list` |
| `getPatch` | `patches.get` |
| `setPatchDecision(id, "merge" \| "reject")` | `patches.transition(id, "merged" \| "rejected")` |

## Connection patterns

- **One store per process.** `connectStore()` caches by URI and database: concurrent and repeated calls share one store and one connection pool, which matters under `tsx watch` and in test files. A failed attempt isn't cached.
- **Close it on shutdown.** `store.close()` closes the pool and drops the cached store, e.g. in Fastify's `onClose` hook. An open pool keeps Node's event loop alive, so a CLI command that never closes the store never exits.
- **Its own connection.** The store uses `mongoose.createConnection`, never mongoose's global default, so its models can't collide with any other mongoose use in the same process. `createRunStore(connection)` wraps a connection you opened yourself.
- **Which database.** An explicit `dbName` option, then `REPRO_MONGODB_DB`, then the database in the URI's path, then `repro`. Set `REPRO_MONGODB_DB=repro_<yourname>` while developing so your runs don't mix with the demo's data on the shared cluster.
- **Defaults sized for the free tier.** Pool of 10, 10-second server selection timeout, `appName: "repro"` so the connections show up by name in Atlas metrics. All are options on `connectStore`.
- **Failures say what to fix.** A failed connection throws `StoreConnectionError` naming the redacted host and the likeliest fix: IP access list, credentials, or a network that blocks SRV lookups.
- **The URI is a secret** (section 9). It's read from the environment and never logged; the `log` option only ever receives the redacted form.

## Errors

Each write that breaks a rule throws a named `StoreError` subclass carrying the IDs involved: `RunNotFoundError`, `RunNotActiveError`, `FindingNotFoundError`, `NotReproducibleError`, `DiagnosisNotFoundError`, `CitationError` (with `missingFindingIds`), `PatchNotFoundError`, `InvalidPatchTransitionError` (with `from` and `to`), and `GateNotSatisfiedError` (with `failedChecks`).

## Tests

```sh
npm test
```

`test/models.test.ts` needs no database: it checks that every Mongoose schema matches its contract key for key, and the connection helpers. `test/store.test.ts` runs every helper against a real `mongod` from `mongodb-memory-server`, never Atlas. The first run downloads a `mongod` binary into `~/.cache/mongodb-binaries`; later runs start in about a second.
