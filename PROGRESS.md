# Lane 3 progress

One line per session: what was done, what's next.

- 2026-09-26 s1: built `@repro/agents` (packages/agents): Gemini wrapper, secret-redacting workspace access, Diagnose (passes real-API integration), Repair loop, Challenger with counter-tests, gate, and the 2-attempt repair-and-verify loop; 71 unit tests green. Stopped at the usage limit.
- 2026-09-26 s2: after credits were added, every real-API test passes (`npm run test:integration`): Repair fixes the SQL injection and moves the hardcoded key to the environment; the Challenger on `gemini-3.1-pro-preview` disputes the detector-fooling fix and confirms the sound one; Diagnose → Repair → Challenger → gate verifies end to end (~2.7 min, 19 calls). Switched the Executor to `exec()`. Merged `lane-3` into main (PR #1, merge commit). Next: once Lane 2's work is on main, merge main into `lane-3`, swap `src/contracts.ts` for `@repro/contracts`, join the npm workspace, and run Repair/Challenger through Lane 2's DockerExecutor.

## Blocked

- **Real sandbox (needs Lane 2 on main, then Docker):** counter-tests and tests only get truly judged by executing them in Lane 2's DockerExecutor (`packages/executor` on `lane-2`, image built from `sandbox/Dockerfile`). Until then, integration tests answer commands with oracles and never execute model code on the host. The Docker daemon isn't running on this machine and the image hasn't been built (the build downloads base images, Semgrep, and rule packs).

## Needs a contracts decision

- `Executor`'s shape: section 4 doesn't define it. Lane 2's contracts package (on `lane-2`) chose `exec(request)`; Lane 3 now uses the same.
- `Patch.challengerVerdict` is required but has no "not yet challenged" value; Repair sets `disputed` (fail closed) with notes "Not yet challenged." A `pending` value would be clearer.
- A secret-removal Patch's `diff` (literal `git diff`) contains the removed secret line, which conflicts with section 9's "never in the Run Store". Lane 3 redacts every diff it shows Gemini, but the stored diff is literal.
- `Workspace` has no test command; Repair detects one (`npm test` / `python -m pytest -q`) or takes it as input.

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
