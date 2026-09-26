# Environment

What a machine needs to build and run Repro, and every environment variable the code reads. `CLAUDE.md` sections 2, 9, and 10 are the source for the rules here.

## Tools

| Tool | Needed by | Install |
|---|---|---|
| Node.js 18+ and npm | Everyone | nodejs.org, or your version manager |
| Git 2.23+ | Everyone | Git's site or your package manager; GitHub SSH or HTTPS credentials already working |
| Claude Code | Everyone (build tool only, not part of the product) | `npm install -g @anthropic-ai/claude-code`, or `curl -fsSL https://claude.ai/install.sh \| bash`; then `claude doctor` |
| claude.ai Pro or Max account | Everyone | Required for Routines and Dispatch; a Console API key alone won't reach them |
| Docker Desktop, or Docker Engine on Linux | Lanes 2 and 3, demo host | Every target-repo command runs in its container (section 9) |
| Semgrep | Lane 2, demo host | `brew install semgrep` or `python3 -m pip install semgrep` |
| gitleaks | Lane 2, demo host | `brew install gitleaks`, or a release binary from the gitleaks GitHub repo |
| GitHub CLI (`gh`) | Optional | Speeds up opening and checking PRs |
| MongoDB Shell (`mongosh`) | Optional | Browse the Run Store from a terminal; Atlas's Data Explorer does the same in the browser |
| WSL2 | Windows only | Run Claude Code inside WSL, not PowerShell or cmd |

## Environment variables

Secrets are marked. Defaults come from the code as of 2026-09-26; where the code and this table disagree, the code wins, so fix the table.

### Secrets

| Variable | Read by | Notes |
|---|---|---|
| `GEMINI_API_KEY` | `@repro/agents` Gemini wrapper (Lane 3); Lane 4's PR narrator goes through the same wrapper | Required for any real model call; unit tests mock the wrapper and don't need it. One key per developer, from Google AI Studio. The demo host uses a key on a billing-linked project. |
| `MONGODB_URI` | `@repro/store` (Lane 1), which the API (Lane 4) and the orchestrator connect through | Connection string for the one shared Atlas cluster Lane 1 provisions and hands out ([MongoDB Atlas](#mongodb-atlas) below). Nobody runs a local database; unit tests use an in-memory `mongod`. The store never logs it and only ever prints it redacted. |

A target-repo GitHub credential for opening repair PRs has no variable name yet. Whatever it becomes: scoped to the minimum, used only at the PR-opening step, never passed to a model.

### Run Store (Lane 1)

| Variable | Default | Notes |
|---|---|---|
| `REPRO_MONGODB_DB` | The database in `MONGODB_URI`'s path, else `repro` | Set `repro_<yourname>` while developing so your runs stay out of the demo's `repro` database on the shared cluster |

### Model routing (Lane 3)

| Variable | Default | Notes |
|---|---|---|
| `REPRO_MODEL_DIAGNOSE` | `gemini-3.1-pro-preview` | Point both Pro roles at `gemini-3.8-flash` if Pro quota is tight; free-tier keys get no Pro requests |
| `REPRO_MODEL_CHALLENGER` | `gemini-3.1-pro-preview` | |
| `REPRO_MODEL_REPAIR` | `gemini-3.8-flash` | |
| `REPRO_MODEL_NARRATOR` | `gemini-3.8-flash` | |
| `REPRO_GEMINI_TRANSPORT` | `request` | `background` polls instead of holding one request open; costs extra requests, so use it only on billing-linked keys |

Lane 3's integration tests (`npm run test:integration` in `packages/agents`) load `GEMINI_API_KEY` from a `.env` at the repo root, and default both Pro roles to Flash unless the variables are already set.

### Sandbox and ingestion (Lane 2)

| Variable | Default | Notes |
|---|---|---|
| `REPRO_SANDBOX_IMAGE` | `repro-sandbox:dev` | Built from `sandbox/Dockerfile` |
| `REPRO_SANDBOX_MEMORY` | `3g` | Container memory limit |
| `REPRO_SANDBOX_CPUS` | `2` | Container CPU limit |
| `REPRO_WORKSPACES_DIR` | `~/.repro/workspaces` | Kept under `$HOME` because Docker Desktop and Colima on macOS only share the home directory with the VM |
| `REPRO_NETWORK_TESTS` | unset | Set to `1` to run the ingest tests that clone from github.com |

### Status surface (Lane 4)

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | API server port |
| `HOST` | `0.0.0.0` | API server bind address |
| `REPRO_API_URL` | `http://localhost:4000` | Where the CLI and the dashboard reach the API |

## Rules for secrets

- Environment variables only: never in the repo, a prompt, a log, or a commit. A `.env` at the repo root is git-ignored for local use.
- Hand `MONGODB_URI` over by direct message or a password manager, not in a Dispatch thread: whatever goes into that thread is a prompt.
- Routines never hold `GEMINI_API_KEY`; anything a routine runs uses the mocked wrapper.
- On unpaid usage, Google may use submitted content to improve its products. Seeded demo repos are fine on a free key; real target repos go through the billing-linked one.
- gitleaks runs with `--redact`, so a real secret's value never reaches a Finding, the Run Store, the dashboard, or a model.

## MongoDB Atlas

One shared cluster is the Run Store for the whole team (section 10). Lane 1 sets it up once; everyone else only needs the connection string.

### Setting up the cluster (Lane 1, once)

1. **Project.** Sign in at cloud.mongodb.com and create a project named `repro`. If the free tier's limits get tight, the MLH student offer adds credit.
2. **Cluster.** Create a free (M0) cluster in the region closest to the demo host. Its 512 MB is plenty for a hackathon's Runs.
3. **Database user.** Under Database Access, add a password-authenticated user such as `repro-app`, let Atlas generate the password, give it the built-in "Read and write to any database" role, and restrict it to this cluster. "Any database" is what lets each developer use their own `repro_<name>` database; the cluster holds nothing but Repro data. A separate user for the demo host lets you rotate its password without touching everyone else's.
4. **Network access.** Under Network Access, add each teammate's current IP ("Add current IP address") and the demo host's. Venue Wi-Fi changes addresses often; if that becomes a fight, `0.0.0.0/0` works, but then the password is the only thing standing in the way, so keep it generated, and delete the entry after the event.
5. **Connection string.** Connect, then Drivers, then Node.js, and copy the `mongodb+srv://` string. Put the password in, URL-encoding any of `@ : / ? # [ ] %`, and add `/repro` before the `?` so the database is explicit:

   ```
   mongodb+srv://repro-app:<password>@<cluster>.mongodb.net/repro?retryWrites=true&w=majority&appName=repro
   ```

6. **Hand it out** by direct message or a password manager, per the rules above.
7. **Check it**, which also builds the indexes listed in `packages/store/README.md`:

   ```sh
   npm run check -w @repro/store
   ```

### Connecting (everyone)

```sh
export MONGODB_URI='mongodb+srv://...'   # from Lane 1; single quotes keep the shell off special characters
export REPRO_MONGODB_DB=repro_<yourname> # optional: your own database while developing
npm run check -w @repro/store            # prints the redacted host, "indexes ensured", and document counts
```

`npm test` never needs this: the store's tests run against an in-memory `mongod`, which `mongodb-memory-server` downloads to `~/.cache/mongodb-binaries` on the first run.

### When the connection fails

`@repro/store` names the likeliest fix in its error. In more detail:

| Error mentions | Cause | Fix |
|---|---|---|
| `querySrv`, `ENOTFOUND _mongodb._tcp...` | The network won't resolve the SRV record behind `mongodb+srv://`; common on venue and campus Wi-Fi | Use the standard `mongodb://host1,host2,host3/...` string instead. In the Connect dialog, pick an older Node.js driver version to see it |
| `Server selection timed out`, `MongoServerSelectionError` | This machine's IP isn't on the access list, or the cluster is paused | Add your current IP under Network Access; resume the cluster if Atlas paused it |
| `bad auth`, `authentication failed` | Wrong user or password, or a special character in the password that isn't URL-encoded | Re-copy the string; encode the password; check the user is allowed on this cluster |
| Documents turning up in a database called `test` | Something connected without `@repro/store` and without a database in the URI | Go through `@repro/store`, or add `/repro` to the URI |

## First-time setup

```sh
git clone git@github.com:Bomoga/repro.git
cd repro
git checkout lane-N        # your lane, per section 11
npm install
npm run build              # type-check
npm test
```

Then export `GEMINI_API_KEY` (Lanes 3 and 4) and `MONGODB_URI` (from Lane 1), confirm the Run Store with `npm run check -w @repro/store`, authenticate Claude Code with your claude.ai account, and pair Dispatch: open Cowork on desktop, turn on Dispatch, scan its QR code from the Claude mobile app. Dispatch only reaches your desktop while it's awake with the app open.
