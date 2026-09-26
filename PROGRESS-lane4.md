# Lane 4 Fallback progress

One line per session: what was done, what's next.

- 2026-09-26 s1: built the full status surface: `@repro/api` (Fastify + tRPC, Run Store
  queries, Trust Report), `@repro/cli` (`repro status`/`watch`/`scan`/`patch`), `@repro/github`
  (Check Runs, PR comment, Gemini-backed PR narrator with a templated fallback), and
  `@repro/web` (minimal React+Vite dashboard: run list, Findings/Diagnoses/Patches, Trust
  Report, merge/reject). 21/21 unit tests pass; API, CLI, and dashboard were each also driven
  for real against a live server (curl, CLI invocations, and a headless-Chromium screenshot of
  the dashboard doing a scan), not just exercised through injected tests. Stopped after hitting
  a push blocker (resolved in s2), not tokens.
- 2026-09-26 s2 (s1's push and missing-CLAUDE.md blockers are resolved): rebuilt the Run Store and finished `@repro/api` / `@repro/cli` against the real
  CLAUDE.md. Run Store: one `RunStore` interface (reads plus the orchestrator's writes), in-memory
  and MongoDB implementations held to one shared conformance suite (the Mongo half runs against a
  real mongod), both enforcing section 4's checkable semantics. API: `runs.summaries`/`detail`,
  single-object gets, target validation matching lane 2's ingest, `/health` that pings the store
  (503 when it can't), demo seed data (`REPRO_SEED_DEMO=1`, `npm run seed`). CLI: typed
  `@trpc/client`, `repro status [--run <id>]`, `scan` (infers local vs GitHub, makes local paths
  absolute, `--watch`), `watch` (exit 0 completed / 1 failed / 2 timeout, retries transient poll
  failures). 112 tests green; also driven by hand against a live server on both stores.
  Next: whichever lane owns the orchestrator wires it to `RunStore` (below).

## Blocked / needs a human

- **Contracts package:** `packages/contracts` is still the verbatim mirror of lane 2's package
  (the one lane 3's notes record as approved). Lane 1's own package (`lane-1`, 8b3b30d) differs:
  no pending proof fields, `FindingSchema`-style names, zod 3, `Executor.run`. `@repro/api` and
  `@repro/cli` import contract *types* only (`Run`, `Finding`, `Diagnosis`, `Patch`), so either
  package works for them; only `test/seed.test.ts` uses lane 2's schema values (`Finding.parse`).
  Pick one package before merging lanes to main.
- **`patches.decide` / `repro patch` record a decision, they don't merge a PR.** Section 9 has a
  human merge on GitHub; a Patch reaching `merged` should really come from the PR merging
  (webhook), not a button. Keep as a fallback, rewire to GitHub, or drop?

## Handoff: how the orchestrator writes runs

- Nothing on this branch consumes queued Runs. The orchestrator can take the store from
  `openRunStore()` (exported by `@repro/api`), poll `listRuns({ status: "queued" })`, and move
  each Run with `updateRun`, `addFindings`, `recordReproduction`, `addDiagnoses`, `savePatch`.
  Every write is checked (see `src/store/invariants.ts`), so a bad one throws a `StoreError`
  (`NOT_FOUND` / `CONFLICT` / `INVALID`) instead of landing.
- Mongo layout: collections `runs`, `findings`, `diagnoses`, `patches`; each document is the
  contract plus `runId` (children only); unique index on `id`; reads project `_id`/`runId` away.

## Needs a contracts/spec decision

- `Run` has no failure reason: a failed Run shows only the stage it failed in.
- `Run` has no field naming a GitHub PR (only `Patch.prUrl`), so `@repro/github`'s Check Run is
  keyed to `(owner, repo, headSha)`.
- Trust Report confidence is a simple point score (tests / no longer reproduces / Challenger
  confirmed / no regressions); section 8 doesn't define a rubric.
- A secret-removal Patch's literal `diff` still contains the removed line (lane 3's note); the
  store saves diffs as given. Redacting at write time would break `git apply`.

## Decisions (reversible calls, one line each)

- The store refuses: reproductionOutput on an unconfirmed Finding; re-recording a reproduction;
  a Diagnosis citing nothing or Findings of another Run; a `verified` Patch that fails the gate;
  `merged` from anything but a decision; status moving backwards; any change to a final Run/Patch.
- A Run's stage `done` and status `completed` are only valid together (stage = stage in flight).
- IDs stay unique store-wide; writes are all-or-nothing per call; Mongo transitions are
  conditional updates, so racing writers can't both win.
- `runs.create` checks targets with lane 2's ingest grammar; local targets must be absolute at
  the API, and the CLI makes them so. `repro scan` with no target scans the current directory.
- The CLI uses `@trpc/client` typed against `AppRouter` (reverses s1's plain-fetch call), so API
  drift is a compile error; `@repro/web` still uses plain fetch against unchanged procedures.
- Demo data loads only on request; every seeded ID has `demo` in it and targets live under
  `/demo/`. Its content follows lane 3's demo target and lane 2's `REPRODUCED ...` protocol.
- Mongo tests use mongodb-memory-server (first run downloads mongod, ~120 MB);
  `MONGODB_TEST_URI` points them at an existing server, `REPRO_SKIP_MONGO_TESTS=1` skips them.
- `buildApp` logs nothing unless asked; `src/main.ts` is the server entrypoint (`npm run dev:api`).
- IDs are `crypto.randomUUID()`, prefixed (`run_...`), matching lane 3's convention.
