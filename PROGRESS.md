# Lane 4 Fallback progress

One line per session: what was done, what's next.

- 2026-09-26 s1: built the full status surface: `@repro/api` (Fastify + tRPC, Run Store
  queries, Trust Report), `@repro/cli` (`repro status`/`watch`/`scan`/`patch`), `@repro/github`
  (Check Runs, PR comment, Gemini-backed PR narrator with a templated fallback), and
  `@repro/web` (minimal React+Vite dashboard: run list, Findings/Diagnoses/Patches, Trust
  Report, merge/reject). 21/21 unit tests pass; API, CLI, and dashboard were each also driven
  for real against a live server (curl, CLI invocations, and a headless-Chromium screenshot of
  the dashboard doing a scan), not just exercised through injected tests. Stopped after hitting
  a push blocker (below), not tokens.

## Blocked

- **This session's container has no `CLAUDE.md`/developer guide at all** (not gitignored-but-
  present -- absent from the whole filesystem). `.gitignore` names
  `repro-developer-guide.md`, which is almost certainly the real spec every other lane's
  PROGRESS notes cite ("section 4", "section 9", "section 10" ...), but that file was never
  placed in this container, unlike (apparently) lane-2's and lane-3's sessions. This lane's own
  task brief ("CLAUDE.md sections 7, 10, 11") assumes it's readable; it isn't. Needs a human to
  either drop `repro-developer-guide.md` into this container/session, or paste sections 7 and
  11 (the Status Surface and GitHub Integration specs) so the API/CLI/dashboard/GitHub shapes
  built here can be checked against the real spec instead of reconstructed from other lanes'
  comments.
- **No push access (needs a human):** every write to `Bomoga/repro` -- `git push`
  (403, "Claude doesn't have GitHub access to Bomoga/repro for your organization") and the
  GitHub MCP server's `push_files` (403, "Resource not accessible by integration") -- is
  refused. All four commits below are local to this container only and will be lost if it's
  reclaimed before a human pushes them. Fix: an org admin installs/reconnects the Claude GitHub
  App with write access for `Bomoga/repro` (github.access doc), then either push
  `lane-4-fallback` from this container or have a session with push access cherry-pick these
  commits.
- **@repro/contracts and @repro/agents are on unmerged branches, not lane-1/main:** section 4's
  contracts were written by lane-2 (unmerged `lane-2` branch), not lane-1 as this lane's brief
  assumed; the Gemini wrapper with the `narrator` role is on lane-3's unmerged `packages/agents`.
  Both were mirrored verbatim into this branch (`packages/contracts`, `packages/gemini`),
  attributed, so the status surface has real contracts to build against instead of a second,
  drifting guess. Delete both mirrors and depend on the real packages once lane-1/2/3 land on
  main; nothing here should diverge from those copies in the meantime.

## Needs a contracts/spec decision

- `Run` has no field naming a GitHub PR (only `Patch.prUrl`), so `@repro/github`'s Check Run is
  keyed to `(owner, repo, headSha)` from the CLI/dashboard's `runs.create` input, not to a PR
  number; the PR comment/narrator functions take a separate `PrTarget` the caller must already
  know. If section 11 defines a Run <-> PR relationship, wire it through instead.
  Lane 4 never opens a PR itself, only annotates one that already exists (`patch.prUrl` implies
  it does): opening the branch/PR is Repair's job, not the status surface's.
- Trust Report confidence is a simple point score (tests pass / original Finding no longer
  reproduces / Challenger confirmed / no new regressions -> high at 4, medium at 2-3, low
  below); section 7, if it defines the Trust Report's exact rubric, should replace this.
- The CLI's `repro watch` polls (default 5s) rather than subscribing to anything, since neither
  `@repro/contracts` nor this lane's brief describes a push/streaming channel from the Run
  Store.

## Decisions (reversible calls, one line each)

- RunStore is an interface with an `InMemoryRunStore` (default, used in every test and when
  `MONGODB_URI` is unset) and a `MongoRunStore` (used when it is set); the status surface makes
  exactly two writes -- `createRun` (from a target ref) and `setPatchDecision` (merge/reject on
  a `verified` Patch) -- everything else is written by other stages.
  `@repro/cli` and `@repro/web` both talk to `@repro/api` over plain `fetch` against the tRPC
  HTTP endpoints rather than `@trpc/client`, since each only calls a handful of fixed
  procedures.
- IDs are `crypto.randomUUID()`, prefixed (`run_...`), matching lane-3's convention.
