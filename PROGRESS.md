# Lane 3 progress

One line per session: what was done, what's next.

- 2026-09-26 s1: built `@repro/agents` (packages/agents): Gemini wrapper, secret-redacting workspace access, Diagnose (passes real-API integration), Repair loop, Challenger with counter-tests, gate, and the 2-attempt repair-and-verify loop; 71 unit tests green. Stopped at the usage limit. Next: switch the contracts mirror's `Executor.run` to Lane 2's `exec`, adopt Lane 2's workspace layout once it's on main, then run Repair/Challenger against the real API and Lane 2's DockerExecutor once there's Gemini quota.

## Blocked

- **Gemini quota (needs a human):** this key's free tier allows 20 requests/day on `gemini-3.8-flash` (spent 2026-09-26), `gemini-3.1-pro-preview` allows 0, and other models return 402 "prepayment credits are depleted". One Repair attempt alone can take ~16 requests, so the real-API Repair/Challenger integration tests (`npm run test:integration`) haven't passed yet. Needs credits or the billing-linked demo key.
- **Merging to main (needs tooling):** `lane-3` is pushed and green, but this machine has no `gh` and the browser pane isn't signed in to GitHub, so no PR was opened. Title-only PR `lane-3` → `main` is ready to open; nothing in it touches `@repro/contracts`.
- **Challenger against real code:** model-written counter-tests can only be judged by actually running them, i.e. in Lane 2's DockerExecutor (on `lane-2`, not main yet). Unit tests use static oracles and never execute model code on the host.

## Needs a contracts decision

- `Executor`'s shape: section 4 doesn't define it. This mirror used `run(request)`; Lane 2's contracts package (on `lane-2`) chose `exec(request)`. Lane 3 will switch to `exec` to match the only real implementation.
- `Patch.challengerVerdict` is required but has no "not yet challenged" value; Repair sets `disputed` (fail closed) with notes "Not yet challenged." A `pending` value would be clearer.
- A secret-removal Patch's `diff` (literal `git diff`) contains the removed secret line, which conflicts with section 9's "never in the Run Store". Lane 3 redacts every diff it shows Gemini, but the stored diff is literal.
- `Workspace` has no test command; Repair detects one (`npm test` / `python -m pytest -q`) or takes it as input.

## Decisions (reversible calls, one line each)

- No root workspace/package.json: `packages/agents` is self-contained. Lane 2 has since scaffolded npm workspaces (`packages/*`) on `lane-2`; align to it once it's on main.
- Integration tests default `REPRO_MODEL_DIAGNOSE`/`REPRO_MODEL_CHALLENGER` to `gemini-3.8-flash` (Pro has 0 free requests); code defaults stay per section 10.
- The wrapper spends one plain request per interaction (dropped sockets retried). Background polling burned the daily quota, so it's opt-in via `REPRO_GEMINI_TRANSPORT=background` with 10s polls, for billing-linked keys.
- Diagnose's `findingIds` enum is split into confirmed/unconfirmed variants, so no Diagnosis can mix them. The post-check also rejects double citations and flags uncovered Findings: one retry, keep the better attempt, drop and report the rest.
- Prioritization is the order of returned Diagnoses; the Assurant plain-language consequence goes in `riskNotes`.
- Secrets: gitleaks-flagged values are recovered using the redacted evidence as a template and replaced by `[REDACTED-SECRET-n]` in everything shown to Gemini; edits restore the token on disk.
- Repair: `finish` doesn't count against the 15-call cap; after 15 working calls, one grace turn accepts only `finish`. Every attempt starts with `git reset --hard headCommit`, via the Executor.
- Reproduction re-runs: any non-zero exit or timeout counts as "still reproduces", matching Lane 2's protocol (1 = reproduced, 0 = not, else undecided), with undecided failing closed.
- Regressions: detectors re-run on the patched tree; a Finding counts only if it's in a changed file, absent from the baseline, and not the cited rule (the reproduction re-run covers that).
- Challenger: tool loop first, then one schema-only verdict call. "confirmed" stands only if at least one counter-test failed before and passes after, and no counter-test's latest run still fails after.
- The verify→diagnose retry reuses the same Diagnosis with the failure as feedback (no re-diagnosis); counter-tests that broke attempt 1 are replayed against attempt 2.
- IDs are `crypto.randomUUID()` (injectable).
