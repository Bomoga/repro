# @repro/orchestrator

The Run Orchestrator from `CLAUDE.md` section 3. It polls the Run Store for queued Runs and takes each one through the pipeline, one at a time:

| Stage | What runs | What lands in the Run Store |
|---|---|---|
| `ingest` | Lane 2's `ingest`: clone the target, pinned to one commit | nothing yet |
| `detect` | Lane 2's detectors, then the reproduction step, all in the sandbox | Findings, then each confirmed one's `reproductionOutput` |
| `diagnose` | Lane 3's `diagnose` on Gemini | Diagnoses |
| `repair` / `verify` | Lane 3's `repairAndVerify`, per Diagnosis whose Findings all reproduced: two attempts at most, the Challenger's counter-tests, the gate | each attempt's Patch: `proposed` while the Challenger works, then `verified` or `rejected` |
| `done` | a PR for each verified Patch on a GitHub target, when enabled | the Patch's `prUrl` |

A stage that throws fails the Run where it stands. A Repair that throws is logged and skipped; the Run fails only if every Repair did. A PR that can't be opened is logged and never fails the Run. Every Gemini interaction, tool call, counter-test, and stage event goes to the Run's log in the Run Store (section 9).

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

## Pull requests

`GitHubPullRequests` applies the verified diff to a clean checkout of `headCommit` in the sandbox, then builds the commit through GitHub's Git Data API, so the token only travels in that client's requests: never to git, a model, or a log. The branch is `repro/<patch id>`. The PR goes to the branch the Run scanned, or the repo's default branch. Its body is the narrator's prose, labeled as Gemini's, above the proof: each Finding's evidence and reproduction output, the same commands after the patch, the tests, regressions, the Challenger's verdict, and the Trust Report, all verbatim. A patch that touches `.github/` never becomes a PR: pushing it would run its workflow changes with the repo's secrets. Nothing here merges; a person does.

When that person merges the PR on GitHub, its Patch becomes `merged` in the Run Store; closing it unmerged makes it `rejected`. Two ways in, and either can run alone:

- **GitHub's webhook**, instant and with no token involved. Set `REPRO_GITHUB_WEBHOOK_SECRET`, then on the target repo add a webhook for *Pull requests* pointing at `<API URL>/github/webhook`, content type `application/json`, with the same secret. Every delivery's signature is checked; an unsigned or mis-signed one gets a 401 and changes nothing.
- **Polling**, for when GitHub can't reach the API (localhost without a tunnel). The orchestrator asks GitHub about each open repair PR every 10 seconds, with the same token that opened it.

A PR is matched to its Patch by the stored `prUrl`, so a PR Repro didn't open changes nothing, and a redelivered webhook, or a poll that loses the race to it, is a no-op.

Shutting the process down (Ctrl+C) marks the Run in flight failed, since no later orchestrator can resume it.
