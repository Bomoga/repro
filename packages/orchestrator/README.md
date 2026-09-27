# @repro/orchestrator

The Run Orchestrator from `CLAUDE.md` section 3. It polls the Run Store for queued Runs and takes each one through the pipeline, one at a time:

| Stage | What runs | What lands in the Run Store |
|---|---|---|
| `ingest` | Lane 2's `ingest`: clone the target, pinned to one commit | nothing yet |
| `detect` | Lane 2's detectors, then the reproduction step, all in the sandbox | Findings, then each confirmed one's `reproductionOutput` |
| `diagnose` | Lane 3's `diagnose` on Gemini | Diagnoses |
| `repair` / `verify` | Lane 3's `repairAndVerify`, per Diagnosis whose Findings all reproduced: two attempts at most, the Challenger's counter-tests, the gate | each attempt's Patch: `proposed` while the Challenger works, then `verified` or `rejected` |
| `done` | a PR for each verified Patch on a GitHub target, when enabled | the Patch's `prUrl` |

A stage that throws fails the Run where it stands. A Repair that throws is logged and skipped; the Run fails only if every Repair did. A PR that can't be opened is logged and never fails the Run. Every Gemini interaction, tool call, counter-test, and stage event goes to the Run's log in the Run Store (section 9), and the log ends with the Run's Gemini request count per model.

Two things end the repairs early. When the Run's Pro-tier request budget (`REPRO_PRO_REQUEST_BUDGET`) can't cover another diagnosis, or runs out in the middle of one, the Run stops scheduling repairs, logs `budget-reached` with the counts and how many diagnoses it skipped, opens PRs for the patches already verified, and completes. When a Gemini daily quota runs out, it does the same and then fails, with the quota's message. The diagnosis that ran into the limit is cut short.

With `REPRO_REPAIR_CONCURRENCY` above 1, several diagnoses are repaired at once. Each one in flight works in its own copy of the Run's workspace, cloned beside it the way Ingest clones a target (the same git settings, so a patch made in a copy applies byte for byte to `headCommit`), and removed when that diagnosis is done unless `REPRO_KEEP_WORKSPACES=1`. The Run's stage is `repair` while any diagnosis is being repaired and `verify` only while every one in flight is with the Challenger. A diagnosis starts only when the budget covers its worst case on top of every one in flight's; the stops above end scheduling, and diagnoses already in flight finish or fail on their own. PRs still wait for the repair phase and open in diagnosis order. Console lines from a diagnosis carry its first eight characters, since several interleave.

## Running it

```sh
npm run sandbox:build   # once: target code only ever runs in this image
npm run control-plane   # the API and the orchestrator in one process
```

Then queue work the usual way: `npm run cli -- scan <path | owner/repo>` or the dashboard. The orchestrator prints each stage and every repair tool call as it happens.

| Variable | |
|---|---|
| `GEMINI_API_KEY` | Required. Read from the repo-root `.env` too. |
| `MONGODB_URI`, `MONGODB_DB` | Lane 1's Atlas store; unset means the in-memory store, which is why the API runs in the same process. |
| `PORT`, `HOST` | The API's address, default `127.0.0.1:4000`. |
| `REPRO_API=off` | Only the orchestrator, beside a separate API process on the same Atlas database. The store's atomic claim keeps two orchestrators from taking one Run. |
| `REPRO_GITHUB_TOKEN` | Turns on PRs for verified Patches on GitHub targets, and polls them for a person's merge or close. Needs contents and pull-request write access on the target repo, nothing more. |
| `REPRO_GITHUB_WEBHOOK_SECRET` | Also takes GitHub's `pull_request` webhook at `POST /github/webhook`. |
| `REPRO_KEEP_WORKSPACES=1` | Keep each Run's clone under `~/.repro/workspaces` for debugging. |
| `REPRO_PRO_REQUEST_BUDGET` | The most requests one Run sends to the Pro-tier models, the ones behind Diagnose and the Challenger after any `REPRO_MODEL_*` override: every attempt, retry, and background poll counts. A positive integer; unset means no cap. Before each diagnosis the Run checks that what's left covers one diagnosis's worst case, 2 attempts × (10 Challenger tool calls + 3) = 26 requests. Keep it under the project's daily quota: 220 leaves room on a 250-a-day Tier 1 project. |
| `REPRO_REPAIR_CONCURRENCY` | How many diagnoses one Run repairs at once; a positive integer, default 1 (one after another in the Run's workspace, as before). Above 1, each diagnosis in flight gets its own workspace copy, and the sandbox runs that many diagnoses' commands side by side, each container with its own memory and CPU limits, so size it to the machine: 3 is a reasonable start. |

## Pull requests

`GitHubPullRequests` applies the verified diff to a clean checkout of `headCommit` in the sandbox, then builds the commit through GitHub's Git Data API, so the token only travels in that client's requests: never to git, a model, or a log. The branch is `repro/<patch id>`. The PR goes to the branch the Run scanned, or the repo's default branch. Its body is the narrator's prose, labeled as Gemini's, above the proof: each Finding's evidence and reproduction output, the same commands after the patch, the tests, regressions, the Challenger's verdict, and the Trust Report, all verbatim. A patch that touches `.github/` never becomes a PR: pushing it would run its workflow changes with the repo's secrets. Nothing here merges; a person does.

When that person merges the PR on GitHub, its Patch becomes `merged` in the Run Store; closing it unmerged makes it `rejected`. Two ways in, and either can run alone:

- **GitHub's webhook**, instant and with no token involved. Set `REPRO_GITHUB_WEBHOOK_SECRET`, then on the target repo add a webhook for *Pull requests* pointing at `<API URL>/github/webhook`, content type `application/json`, with the same secret. Every delivery's signature is checked; an unsigned or mis-signed one gets a 401 and changes nothing.
- **Polling**, for when GitHub can't reach the API (localhost without a tunnel). The orchestrator asks GitHub about each open repair PR every 10 seconds, with the same token that opened it.

A PR is matched to its Patch by the stored `prUrl`, so a PR Repro didn't open changes nothing, and a redelivered webhook, or a poll that loses the race to it, is a no-op.

Shutting the process down (Ctrl+C) marks the Run in flight failed, since no later orchestrator can resume it.
