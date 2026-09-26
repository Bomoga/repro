# @repro/store

The Run Store from `CLAUDE.md` sections 3 and 10: MongoDB Atlas collections for Runs, Findings, Diagnoses, and Patches, plus each Run's retained prompt and tool-call log. It is the single source of truth for the CLI, the dashboard, and GitHub Checks.

The collections, indexes, and the rules enforced on every write are specified under [Storage spec](#storage-spec) below; the rest of this file covers how to use the package.

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
await store.findings.markReproducible(findingId, reproductionOutput); // only after the Executor demonstrated the issue

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
| runs | `claimNextQueued()`, `claim(id)` | Atomic queued -> running, so two orchestrators never claim the same Run; `claim` returns null unless that Run is queued |
| runs | `setStage`, `setStatus`, `complete`, `fail` | Only while queued, running, or blocked; a finished Run never changes |
| findings | `insert(runId, findings)`, `get`, `getMany`, `list(runId, filters)` | Filters: `reproducible`, `detectorId`, `severity`, `category`; file order |
| findings | `markReproducible(id, reproductionOutput?)`, `counts(runId)` | The output is stored with the flip and never edited; `counts` gives `{ total, reproducible }`, demo beat 2's two numbers |
| diagnoses | `insert(runId, diagnoses)`, `get`, `list`, `citing(findingId)`, `listRepairable(runId)` | |
| patches | `insert(runId, patch)`, `get`, `list(runId, { status })`, `listByDiagnosis`, `listByStatus` | `listByStatus("verified")` is the merge queue |
| patches | `transition(id, to)`, `replace(runId, patch)`, `setPrUrl(id, url)` | `replace` refines a stored Patch (the Challenger's verdict, its notes) under the same status rules; `gateFailures(patch)` and `PATCH_TRANSITIONS` are exported for reuse |
| run_logs | `append`, `list(runId)`, `writer(runId)` | |

Batch inserts are idempotent: re-sending an object whose `id` is already stored for that Run leaves the stored one untouched and counts it in `alreadyPresent`, so an orchestrator retrying after a timeout can't undo a `reproducible` flip. Reusing an `id` under a different Run fails on the unique index.

### Lane 4's `RunStore` interface

The API's Mongo store (`packages/api/src/store/mongo.ts`) is Lane 4's `RunStore` over this package. It checks Lane 4's invariants first, the ones its in-memory store enforces too, then writes through these helpers. Reads with no helper here (paging with an offset, insertion order, per-Run tallies) use `store.models`.

| Lane 4 (`packages/api/src/store/types.ts`) | `@repro/store` |
|---|---|
| `createRun`, `insertRun`, `getRun` | `runs.create`, `runs.insert`, `runs.get` |
| `updateRun(id, { stage, status })` | `runs.setStage`, `runs.setStatus`, `runs.complete`, `runs.fail` |
| `addFindings`, `recordReproduction(id, output)`, `getFinding` | `findings.insert`, `findings.markReproducible`, `findings.get` |
| `addDiagnoses`, `getDiagnosis` | `diagnoses.insert`, `diagnoses.get` |
| `savePatch`, `listPatches`, `getPatch` | `patches.insert` or `patches.replace`, `patches.list`, `patches.get` |
| `setPatchDecision(id, "merge" \| "reject")` | `patches.transition(id, "merged" \| "rejected")` |

## Connection patterns

- **One store per process.** `connectStore()` caches by URI and database: concurrent and repeated calls share one store and one connection pool, which matters under `tsx watch` and in test files. A failed attempt isn't cached.
- **Close it on shutdown.** `store.close()` closes the pool and drops the cached store, e.g. in Fastify's `onClose` hook. An open pool keeps Node's event loop alive, so a CLI command that never closes the store never exits.
- **Its own connection.** The store uses `mongoose.createConnection`, never mongoose's global default, so its models can't collide with any other mongoose use in the same process. `createRunStore(connection)` wraps a connection you opened yourself.
- **Which database.** An explicit `dbName` option, then `REPRO_MONGODB_DB`, then the database in the URI's path, then `repro`. Set `REPRO_MONGODB_DB=repro_<yourname>` while developing so your runs don't mix with the demo's data on the shared cluster.
- **Defaults sized for the free tier.** Pool of 10, 10-second server selection timeout, `appName: "repro"` so the connections show up by name in Atlas metrics. All are options on `connectStore`.
- **Failures say what to fix.** A failed connection throws `StoreConnectionError` naming the redacted host and the likeliest fix: IP access list, credentials, or a network that blocks SRV lookups.
- **The URI is a secret** (section 9). It's read from the environment and never logged; the `log` option only ever receives the redacted form.

## Storage spec

Each section 4 contract is stored as it is: one collection per contract, one contract object per document, no field renamed or reshaped.

### Collections

| Collection | One document per | Storage-only fields | Written by | Read by |
|---|---|---|---|---|
| `runs` | `Run` | none | Run Orchestrator | CLI, API, dashboard |
| `findings` | `Finding` | `runId` | Detect; the reproduction step flips `reproducible` | Diagnose, Repair, Challenger, Trust Report |
| `diagnoses` | `Diagnosis` | `runId` | Diagnose | Repair, Challenger, status surface |
| `patches` | `Patch`, with `regressionFindings` embedded as full `Finding` objects | `runId` | Repair and the Verify gate; the status surface records the human's merge or reject | Status surface, PR narrator |
| `run_logs` | Prompt or tool-call record (section 9) | `runId`, `at`, `kind`, `entry` | The Gemini wrapper, through a writer the orchestrator hands it | Anyone asking "why did it do that" |

- **`id` is the contract's own string ID,** generated upstream, and carries a unique index. Mongo's `_id` and the storage-only `runId` never leave the store: every read is parsed with the `@repro/contracts` schemas, so it comes back as exactly the contract.
- **`runId` ties a document to its Run.** Findings, Diagnoses, and Patches don't carry it in section 4, so the store adds it on write and strips it on read. An `id` is unique across all Runs, not just within one.
- **Every write is parsed with the `@repro/contracts` schemas first.** The Mongoose schemas are `strict: "throw"`, so if a contract gains a field and `src/models.ts` doesn't, writes fail instead of Mongo dropping the field. `test/models.test.ts` checks the same without a database. A change to a contract updates `models.ts` in the same PR; the adopted proof fields are already there (`reproductionOutput` on findings and the embedded Finding, `reproductionOutputAfter` on patches).
- **Enum values come from the contracts.** The Mongoose schemas read them off the `Finding`, `Patch`, and `Run` schemas (aliased `FindingSchema` and so on in `src/contracts.ts`), so they can't drift.
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

## Errors

Each write that breaks a rule throws a named `StoreError` subclass carrying the IDs involved: `RunNotFoundError`, `RunNotActiveError`, `FindingNotFoundError`, `NotReproducibleError`, `DiagnosisNotFoundError`, `CitationError` (with `missingFindingIds`), `PatchNotFoundError`, `InvalidPatchTransitionError` (with `from` and `to`), and `GateNotSatisfiedError` (with `failedChecks`).

## Tests

```sh
npm test
```

`test/models.test.ts` needs no database: it checks that every Mongoose schema matches its contract key for key, and the connection helpers. `test/store.test.ts` runs every helper against a real `mongod` from `mongodb-memory-server`, never Atlas. The first run downloads a `mongod` binary into `~/.cache/mongodb-binaries`; later runs start in about a second.
