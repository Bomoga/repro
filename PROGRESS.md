# Lane 3 progress

One line per session: what was done, what's next.

- 2026-09-26 s1: built `@repro/agents` (packages/agents): Gemini wrapper, secret-redacting workspace access, Diagnose (passes real-API integration), Repair loop, Challenger with counter-tests, gate, and the 2-attempt repair-and-verify loop; 71 unit tests green. Stopped at the usage limit.
- 2026-09-26 s2: after credits were added, every real-API test passes (`npm run test:integration`): Repair fixes the SQL injection and moves the hardcoded key to the environment; the Challenger on `gemini-3.1-pro-preview` disputes the detector-fooling fix and confirms the sound one; Diagnose → Repair → Challenger → gate verifies end to end (~2.7 min, 19 calls). Switched the Executor to `exec()`. Merged `lane-3` into main (PR #1, merge commit).
- 2026-09-26 s3: contracts approved (section 4 as written; Lane 2's `@repro/contracts` follows it). Lane 3 doesn't merge `lane-2`; Lane 2 merges its own branch. Added Python-target coverage for test-command detection and secret extraction (74 unit tests). Next: when Lane 2's work reaches main, merge main into `lane-3`, swap `src/contracts.ts` for re-exports from `@repro/contracts`, join the npm workspace, and run Repair/Challenger through Lane 2's DockerExecutor.

- 2026-09-26 s4: reviewed Lane 4's PR #3 (merged by others despite the review) and Lane 2's PR #4; resolved #4's conflicts with #3 on `lane-2` (approved Zod contracts kept, committed node_modules/dist untracked, Lane 4's web/cli excluded from the root type-check) and merged it. `@repro/agents` now joins the npm workspace, re-exports `@repro/contracts`, extends `tsconfig.base.json`, and has `test/sandbox.int.ts` (Lane 2's ingest/detect/reproduce + DockerExecutor + real Gemini). Next: build the sandbox image and run `sandbox.int.ts`.

## Waiting

- **Real sandbox run:** `test/sandbox.int.ts` skips until Docker Desktop is running and `npm run sandbox:build` has built `repro-sandbox:dev` (the build downloads base images, Semgrep, and rule packs).
- **Lane 1** has a third `@repro/contracts` (plus api/cli packages) on `lane-1`; it will hit the same add/add conflicts against main and needs reconciling with the approved package.
- **Windows:** Lane 2's `repo-adapter.test.ts` symlink test fails on Windows (`C:/etc/hosts`), so the root `npm test` is red on this machine; reported in the PR #4 review.

## Contracts (approved 2026-09-26: section 4 as written)

- `Executor` is `exec(request)`, as in Lane 2's package; Lane 3 uses it.
- The pending proof fields are adopted as optional: Repair writes `reproductionOutputAfter` from the Executor, never from a model.
- `Patch.challengerVerdict` has no "not yet challenged" value, so Repair emits `disputed` (fail closed) with notes "Not yet challenged." until the Challenger runs.
- `Patch.diff` stays the literal `git diff`, so a secret-removal diff contains the removed line; Lane 3 redacts every diff it shows a model, and keeping it out of the Run Store is a storage-side concern (section 9).
- `Workspace` has no test command: Repair takes one as input or detects it (`npm test`, `python -m pytest -q`). With no detectable suite, `testsPassed` is false and the gate can't verify, so demo repos need tests.

## Decisions (reversible calls, one line each)

- No root workspace/package.json: `packages/agents` is self-contained. Lane 2 has since scaffolded npm workspaces (`packages/*`) on `lane-2`; align to it once it's on main.
- Real-API tests are named `*.int.ts` and run only via `npm run test:integration`, so the workspace root's `packages/*/test/**/*.test.ts` glob never makes paid calls.
- Integration tests default `REPRO_MODEL_DIAGNOSE`/`REPRO_MODEL_CHALLENGER` to `gemini-3.8-flash` (free-tier keys get 0 Pro requests); set them to `gemini-3.1-pro-preview` on a billing-linked key. Code defaults stay per section 10.
- The wrapper spends one plain request per interaction (dropped sockets retried). Background polling burned the daily quota, so it's opt-in via `REPRO_GEMINI_TRANSPORT=background` with 10s polls, for billing-linked keys.
- Diagnose's `findingIds` enum is split into confirmed/unconfirmed variants, so no Diagnosis can mix them. The post-check also rejects double citations and flags uncovered Findings: one retry, keep the better attempt, drop and report the rest.
- Prioritization is the order of returned Diagnoses; the Assurant plain-language consequence goes in `riskNotes`.
- Secrets: gitleaks-flagged values are recovered using the redacted evidence as a template (matches Lane 2's gitleaks evidence format) and replaced by `[REDACTED-SECRET-n]` in everything shown to Gemini; edits restore the token on disk.
- Repair: `finish` doesn't count against the 15-call cap; after 15 working calls, one grace turn accepts only `finish`. Every attempt starts with `git reset --hard headCommit`, via the Executor.
- Reproduction re-runs: any non-zero exit or timeout counts as "still reproduces", matching Lane 2's protocol (1 = reproduced, 0 = not, else undecided), with undecided failing closed.
- Regressions: detectors re-run on the patched tree; a Finding counts only if it's in a changed file, absent from the baseline, and not the cited rule (the reproduction re-run covers that).
- Challenger: tool loop first, then one schema-only verdict call. "confirmed" stands only if at least one counter-test failed before and passes after, and no counter-test's latest run still fails after.
- The verify→diagnose retry reuses the same Diagnosis with the failure as feedback (no re-diagnosis); counter-tests that broke attempt 1 are replayed against attempt 2.
- IDs are `crypto.randomUUID()` (injectable).
