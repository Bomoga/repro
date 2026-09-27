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
| `REPRO_GEMINI_AUTH` | How Gemini requests authenticate: `api-key` (the default) or `google`, a Google sign-in instead of a key ([below](#signing-in-with-google-instead-of-an-api-key)). Anything else stops startup. |
| `GEMINI_API_KEY` | Required with `api-key`. Read from the repo-root `.env` too. With `google` it must be unset, and `GOOGLE_API_KEY` with it: the SDK would send the key instead of the sign-in. |
| `REPRO_GEMINI_QUOTA_PROJECT` | Required with `google`: the ID of the Google Cloud project the requests are billed to, sent as `x-goog-user-project` on every one. |
| `GOOGLE_APPLICATION_CREDENTIALS` | With `google`, optional: a credentials file to use instead of the one `gcloud auth application-default login` writes, such as a service account's key. |
| `MONGODB_URI`, `MONGODB_DB` | Lane 1's Atlas store; unset means the in-memory store, which is why the API runs in the same process. |
| `PORT`, `HOST` | The API's address, default `127.0.0.1:4000`. |
| `REPRO_API=off` | Only the orchestrator, beside a separate API process on the same Atlas database. The store's atomic claim keeps two orchestrators from taking one Run. |
| `REPRO_GITHUB_TOKEN` | Turns on PRs for verified Patches on GitHub targets, and polls them for a person's merge or close. Needs contents and pull-request write access on the target repo, nothing more. |
| `REPRO_GITHUB_WEBHOOK_SECRET` | Also takes GitHub's `pull_request` webhook at `POST /github/webhook`. |
| `REPRO_KEEP_WORKSPACES=1` | Keep each Run's clone under `~/.repro/workspaces` for debugging. |
| `REPRO_PRO_REQUEST_BUDGET` | The most requests one Run sends to the Pro-tier models, the ones behind Diagnose and the Challenger after any `REPRO_MODEL_*` override: every attempt, retry, and background poll counts. A positive integer; unset means no cap. Before each diagnosis the Run checks that what's left covers one diagnosis's worst case, 2 attempts × (10 Challenger tool calls + 3) = 26 requests. Keep it under the project's daily quota: 220 leaves room on a 250-a-day Tier 1 project. |
| `REPRO_REPAIR_CONCURRENCY` | How many diagnoses one Run repairs at once; a positive integer, default 1 (one after another in the Run's workspace, as before). Above 1, each diagnosis in flight gets its own workspace copy, and the sandbox runs that many diagnoses' commands side by side, each container with its own memory and CPU limits, so size it to the machine: 3 is a reasonable start. |

## Signing in with Google instead of an API key

With `REPRO_GEMINI_AUTH=google`, Diagnose, Repair, and the Challenger call Gemini with short-lived OAuth tokens from the operator's Google sign-in instead of `GEMINI_API_KEY`: the Application Default Credentials that `gcloud` writes, which the SDK refreshes on its own. It's still the Gemini Developer API and the same Interactions API, not Vertex AI. Signing in changes the secret, not who pays: every request, background polls and cancels included, names `REPRO_GEMINI_QUOTA_PROJECT` in its `x-goog-user-project` header, so that project's quota and billing apply, whatever quota project the credentials file names. The Pro request budget, per-day quotas, and 429 retries work as they do with a key.

Google calls this setup [appropriate for testing](https://ai.google.dev/gemini-api/docs/oauth), with two limits to plan around:

- **A sign-in lasts 7 days.** While the OAuth consent screen's publishing status is Testing, Google ends a test user's authorization 7 days after consent ([Google](https://developers.google.com/identity/protocols/oauth2#expiration)). Every request then fails with `invalid_grant` until you sign in again (step 5), so sign in again the day before a demo.
- **Only test users, behind a warning.** In Testing, only the consent screen's test users (up to 100) can sign in, and each first sees "Google hasn't verified this app": choose Continue. Verification only comes into it if you publish the app to production, where Google may review it before the warning goes, and an unverified app is capped at 100 new users ([Google](https://support.google.com/cloud/answer/15549945)). A demo host needs neither: stay in Testing.

### Setup on the demo host

Once per machine, in the billing-linked project the demo's key belongs to:

1. **Install the Google Cloud CLI**: `winget install -e --id Google.CloudSDK` on Windows, or the installer at <https://cloud.google.com/sdk/docs/install>. In a new terminal, `gcloud --version` should answer.
2. **Enable the API.** In the [Cloud console](https://console.cloud.google.com), pick the project and note its project ID, then APIs & Services > Library > Generative Language API > Enable.
3. **Set up the consent screen.** Google Auth Platform > Branding: an app name and your email. Audience: user type **External**, publishing status **Testing**, and under Test users, Add users with the Google account you'll sign in with.
4. **Create a Desktop OAuth client.** Google Auth Platform > Clients > Create client, application type **Desktop app**. Download its JSON as `client_secret.json` into a folder outside the repo, such as `~/repro-oauth`. It holds the client's secret: never commit it, paste it anywhere, or put it in `.env`.
5. **Sign in**, from that folder, in PowerShell or Git Bash:

   ```sh
   cd ~/repro-oauth
   gcloud auth application-default login --client-id-file=client_secret.json --scopes='https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/generative-language.retriever'
   ```

   In the browser, pick the test account, choose Continue past the unverified-app screen, and allow both scopes. gcloud saves the sign-in to `%APPDATA%\gcloud\application_default_credentials.json` on Windows and `~/.config/gcloud/application_default_credentials.json` elsewhere. That file holds a refresh token and the client's secret: treat it like the API key.
6. **Set the quota project** from step 2, in the repo-root `.env`:

   ```
   REPRO_GEMINI_QUOTA_PROJECT=<project-id>
   ```

   The signed-in account needs `serviceusage.services.use` on that project, which its owner has. (`gcloud auth application-default set-quota-project <project-id>` writes the same project into the credentials file for other tools; Repro sends its own either way.)
7. **Switch over** in `.env`: add `REPRO_GEMINI_AUTH=google`, and delete or comment out `GEMINI_API_KEY` (and `GOOGLE_API_KEY` if it's there). Startup refuses while either key is set, since the SDK would send the key instead.
8. **Check it with one request**, before touching the running control plane, which keeps its old settings until it restarts:

   ```sh
   npm run gemini:check -w @repro/orchestrator
   ```

   It spends one Pro-tier request (the Diagnose role's model, no retries) and prints `gemini requests use the Google sign-in in <file>, billed to project <project-id>`, then the model's one-word answer. A failure prints what to fix instead; see the table below.
9. **Restart the control plane**: Ctrl+C, then `npm run control-plane`. Its startup lines include the same `gemini requests use the Google sign-in ...`.

To go back to the API key, delete `REPRO_GEMINI_AUTH` from `.env` (or set it to `api-key`), put `GEMINI_API_KEY` back, and restart the control plane. The sign-in can stay; `gcloud auth application-default revoke` removes it.

A service account works too: point `GOOGLE_APPLICATION_CREDENTIALS` at its key file instead of steps 3 to 5. Repro doesn't create or manage keys.

### When the sign-in fails

A sign-in failure stops the request without a retry, starts with `Google sign-in:`, and says what to run; none repeats a token, a secret, or the credentials file. Signing in again takes effect from the next Run, with no restart; a change to `.env` needs one.

| The error says | Why | Fix |
|---|---|---|
| `expired or been revoked (invalid_grant)` | The 7-day Testing sign-in ran out, or it was revoked | Step 5 again |
| `refused to refresh the access token (...)` | Google refused the refresh for another reason, such as a deleted OAuth client (`invalid_client`) | Steps 4 and 5 again |
| `rejected the access token` | Gemini didn't accept the token it was sent (401) | Step 5 again |
| `no Application Default Credentials` | Never signed in on this machine, or the file was removed | Step 5 |
| `couldn't get an access token from the Application Default Credentials` | The credentials file is missing, unreadable, or damaged | Step 5 again, or fix `GOOGLE_APPLICATION_CREDENTIALS` |
| `lacks the scopes Gemini needs` | Signed in without both `--scopes` | Step 5, with both |
| `isn't enabled in <project>` | The Generative Language API is off in the quota project | Step 2 |
| `can't be billed to REPRO_GEMINI_QUOTA_PROJECT` | A wrong project ID, or one the account may not use | Fix the ID, or give the account `serviceusage.services.use` there (the Service Usage Consumer role) |
| `refused the signed-in account` | The account has no access to the quota project | Grant it access, or sign in with an account that has it |

Startup catches the rest before anything runs: an unknown `REPRO_GEMINI_AUTH`, a key still set, a missing or malformed `REPRO_GEMINI_QUOTA_PROJECT`, `GOOGLE_GENAI_DEBUG` (it makes the SDK print request headers, the access token among them), and no credentials file where Google's auth library would look.

## Pull requests

`GitHubPullRequests` applies the verified diff to a clean checkout of `headCommit` in the sandbox, then builds the commit through GitHub's Git Data API, so the token only travels in that client's requests: never to git, a model, or a log. The branch is `repro/<patch id>`. The PR goes to the branch the Run scanned, or the repo's default branch. Its body is the narrator's prose, labeled as Gemini's, above the proof: each Finding's evidence and reproduction output, the same commands after the patch, the tests, regressions, the Challenger's verdict, and the Trust Report, all verbatim. A patch that touches `.github/` never becomes a PR: pushing it would run its workflow changes with the repo's secrets. Nothing here merges; a person does.

When that person merges the PR on GitHub, its Patch becomes `merged` in the Run Store; closing it unmerged makes it `rejected`. Two ways in, and either can run alone:

- **GitHub's webhook**, instant and with no token involved. Set `REPRO_GITHUB_WEBHOOK_SECRET`, then on the target repo add a webhook for *Pull requests* pointing at `<API URL>/github/webhook`, content type `application/json`, with the same secret. Every delivery's signature is checked; an unsigned or mis-signed one gets a 401 and changes nothing.
- **Polling**, for when GitHub can't reach the API (localhost without a tunnel). The orchestrator asks GitHub about each open repair PR every 10 seconds, with the same token that opened it.

A PR is matched to its Patch by the stored `prUrl`, so a PR Repro didn't open changes nothing, and a redelivered webhook, or a poll that loses the race to it, is a no-op.

Shutting the process down (Ctrl+C) marks the Run in flight failed, since no later orchestrator can resume it.
