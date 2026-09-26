# Lane 4 (fallback) progress

One line per session: what was done, what's next.

- 2026-09-26 s1: no root workspace existed on `main` yet (only `packages/agents` from lane 3, unwired). Added the root `package.json` workspace and three new packages: `@repro/contracts` (mirror of lane 2's unmerged section-4 contracts, since neither lane 1's real package nor lane 2's branch had reached main), `@repro/api` (Fastify + tRPC over a `RunStore` abstraction, with both an in-memory and a Mongoose-backed implementation), and `@repro/cli` (`repro status`/`watch`/`scan`, typed against the API's `AppRouter`). Also built the GitHub integration (PR comments, check runs, commit statuses via `@octokit/rest`) and the PR narrator, which reuses lane 3's `@repro/agents` Gemini wrapper and its existing `narrator` role/model config — no new model plumbing needed. 110 tests green across all four packages (`npm test`); manually smoke-tested the built API (`/health`, `/trpc/health`) and CLI (`scan` → `status` → detail view) end to end against a live in-memory server. Web dashboard not started yet.

## Decisions

- `@repro/contracts` here is a full package (not a source-level mirror like lane 3's `contracts.ts`) because three of my own packages (api, cli, and indirectly web) need to share the same types; it's field-for-field identical to lane 2's version so it should merge cleanly once lane 1 or lane 2's real package lands on main. At that point: delete `packages/contracts`'s own body and re-export from theirs, same as lane 3's plan.
- `RunStore` is an interface, not a Mongoose coupling, specifically so the API/CLI test suite runs with no Mongo instance available (`MemoryRunStore`) while `MongoRunStore` is the real section-9 persistence layer, selected by setting `MONGODB_URI`. `runId` is a storage-only association field on Finding/Diagnosis/Patch documents — it's not part of the section 4 contracts, matching how lane 3's PROGRESS notes treat storage concerns as separate from the contracts.
- Root build must run in dependency order (`contracts` → `agents` → `api` → `cli`) since each package's `main`/`exports` point at its own `dist/`, so plain `npm run build --workspaces` (alphabetical) breaks; the root `build` script lists them explicitly, and `pretest` runs it so `npm test` always builds first.
- CLI talks to the API over `@trpc/client`'s `httpBatchLink`, typed against `@repro/api`'s exported `AppRouter` type (via the package's `./router` export) — so a CLI/API drift shows up as a type error, not a runtime surprise.
- No chat surface anywhere, per section 8: `scan`'s only inputs are a target ref plus `--kind`/`--trigger` toggles; there is no free-text prompt box in the CLI or (planned) dashboard.
- The Run Orchestrator that actually drives ingest → detect → diagnose → repair → verify isn't owned by Lane 4; `runs.create`/`repro scan` only queue a `Run` row at `stage: "ingest", status: "queued"` and stop there. Something else needs to pick up queued runs and advance them — not yet wired to any lane's code in this repo.
- A `lane_four_features` branch already exists on the remote with its own (uncommitted-node_modules, non-conforming-commit-format) lane 4 work; per this task's own instructions ("work on lane-4-fallback branch only"), I did not touch or merge it and built independently.

## Known gaps / next session

- Web dashboard (`@repro/web`, scope item 3) not started — stop condition only requires API+CLI, and this session's budget went to a fully tested API/CLI/GitHub/narrator slice instead of a partial dashboard.
- GitHub integration and the PR narrator are unit-tested against fakes only; nothing has exercised them against a real GitHub repo or a real Gemini key.
- No CLAUDE.md was present anywhere in this checkout (it's gitignored on purpose) so "sections 7, 10, 11" referenced by this task's brief could not be read directly; scope/behavior here was inferred from this task's own Scope/Build Order text, `PROGRESS.md` (lane 3), and lane 2's `@repro/contracts` source comments (which do quote section 4 semantics inline). Worth reconciling against the real CLAUDE.md once available.
