import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Octokit } from "@octokit/rest";
import { createGeminiClient } from "@repro/agents";
import { buildApp, openRunStore, runtimeSettings } from "@repro/api";
import { DEFAULT_SANDBOX_IMAGE, DockerExecutor, sandboxAvailable } from "@repro/executor";
import { geminiAtStartup, geminiStartupLine, positiveIntegerFromEnv } from "./config.ts";
import { Orchestrator } from "./orchestrator.ts";
import { GitHubPullRequests } from "./pull-request.ts";
import { LocalBranches, RoutedPullRequests, pullRequestModeFromEnv } from "./local-branches.ts";
import { PullRequestSync } from "./pull-request-sync.ts";

// The control plane in one process: the API and the Run Orchestrator on the same Run Store, so
// the in-memory store works as well as Atlas. Environment (the repo-root .env is read first):
//   REPRO_GEMINI_AUTH       how Diagnose, Repair, and the Challenger reach Gemini: api-key (default)
//                           or google, the operator's Google sign-in instead of a key (README.md has
//                           the setup); anything else fails at startup, which prints the mode
//   GEMINI_API_KEY          required with api-key; with neither it nor REPRO_GEMINI_AUTH set, Runs
//                           stop after reproduction, which needs no model. With google it must be unset, GOOGLE_API_KEY too,
//                           or the SDK would send it instead of the sign-in
//   REPRO_GEMINI_QUOTA_PROJECT  required with google: the Google Cloud project ID its requests are
//                           billed to, printed at startup. The sign-in itself is the Application
//                           Default Credentials from `gcloud auth application-default login` (or the
//                           file GOOGLE_APPLICATION_CREDENTIALS names): startup checks the file is
//                           there, and never opens it.
//   MONGODB_URI             Lane 1's Atlas store (unset: in-memory, lost on restart)
//   MONGODB_DB              database name, when the URI doesn't name one
//   PORT, HOST              the API's listen address (default 127.0.0.1:4000)
//   REPRO_API=off           only the orchestrator, beside an API process on the same Atlas store
//   REPRO_GITHUB_TOKEN      open a PR for each verified Patch on a GitHub target (unset: no PRs),
//                           and poll those PRs so a merge or close on GitHub settles the Patch
//   REPRO_PR_MODE           where verified patches go: auto (default: a GitHub PR when the token can
//                           push to the repo, else a local branch), github, or local (a commit on
//                           repro/<patch> in a clone under ~/.repro/local-branches)
//   REPRO_GITHUB_WEBHOOK_SECRET  also take GitHub's pull_request webhook at POST /github/webhook
//   REPRO_KEEP_WORKSPACES=1 keep each Run's workspace after it finishes
//   REPRO_PRO_REQUEST_BUDGET  the most requests one Run sends to the Pro-tier models (the ones behind
//                           Diagnose and the Challenger, after REPRO_MODEL_* overrides), a positive
//                           integer; unset means no cap. A Run stops scheduling repairs when what's
//                           left can't cover another diagnosis's worst case, opens PRs for what it
//                           verified, and completes. Set it under the project's daily quota.
//   REPRO_REPAIR_CONCURRENCY  how many diagnoses one Run repairs at once, a positive integer (default
//                           1: one after another, in the Run's workspace). Above 1, each diagnosis in
//                           flight gets its own copy of the workspace, and the sandbox runs that many
//                           diagnoses' tests and counter-tests side by side.

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const gemini = geminiAtStartup();
  const proRequestBudget = positiveIntegerFromEnv("REPRO_PRO_REQUEST_BUDGET");
  const repairConcurrency = positiveIntegerFromEnv("REPRO_REPAIR_CONCURRENCY") ?? 1;
  if (!(await sandboxAvailable())) {
    throw new Error(`the sandbox image ${DEFAULT_SANDBOX_IMAGE} isn't available: start Docker and run \`npm run sandbox:build\`. Target code never runs outside it.`);
  }

  const store = await openRunStore();
  const withApi = process.env.REPRO_API !== "off";
  if (!withApi && store.kind === "memory") {
    throw new Error("REPRO_API=off needs MONGODB_URI: with the in-memory store, nothing else could queue Runs for this orchestrator.");
  }

  const executor = new DockerExecutor();
  const token = process.env.REPRO_GITHUB_TOKEN;
  const octokit = token ? new Octokit({ auth: token }) : undefined;
  pullRequestModeFromEnv(); // a bad REPRO_PR_MODE still fails at startup
  const prMode = runtimeSettings.pullRequestMode();
  if (prMode === "github" && !octokit) throw new Error("REPRO_PR_MODE=github needs REPRO_GITHUB_TOKEN");
  const say = (line: string) => console.log(line);
  const orchestrator = new Orchestrator({
    store,
    executor,
    gemini: gemini.auth === "none" ? undefined : (log, budget) => createGeminiClient({ log, budget }),
    proRequestBudget,
    repairConcurrency,
    pullRequests: new RoutedPullRequests(() => runtimeSettings.pullRequestMode(), new LocalBranches(), octokit ? new GitHubPullRequests(octokit, executor) : undefined, octokit),
    keepWorkspace: process.env.REPRO_KEEP_WORKSPACES === "1",
    say,
  });
  const sync = octokit ? new PullRequestSync(store, octokit, say) : undefined;
  sync?.start();

  const app = withApi ? buildApp(store, { githubWebhookSecret: process.env.REPRO_GITHUB_WEBHOOK_SECRET }) : undefined;
  if (app) {
    const port = Number(process.env.PORT ?? 4000);
    const host = process.env.HOST ?? "127.0.0.1";
    await app.listen({ port, host });
    console.log(`api listening on http://${host}:${port}`);
  }
  const stale = await store.listRuns({ status: "running" });
  if (stale.length > 0) {
    console.log(`left running by an earlier process, and won't resume: ${stale.map((run) => run.id).join(", ")}`);
  }
  const prWhere = prMode === "local" || !token ? "local branches under ~/.repro/local-branches" : prMode === "github" ? "GitHub PRs" : "GitHub PRs where the token can push, local branches elsewhere";
  console.log(`orchestrator polling the ${store.kind} run store; verified patches go to ${prWhere} (REPRO_PR_MODE=${prMode})`);
  console.log(geminiStartupLine(gemini));
  console.log(proRequestBudget ? `each run may send ${proRequestBudget} requests to the Pro-tier models` : "no cap on a run's Pro-tier requests (set REPRO_PRO_REQUEST_BUDGET for one)");
  console.log(repairConcurrency > 1 ? `each run repairs up to ${repairConcurrency} diagnoses at once` : "each run repairs one diagnosis at a time (REPRO_REPAIR_CONCURRENCY raises it)");
  if (app && process.env.REPRO_GITHUB_WEBHOOK_SECRET) console.log("github webhook at POST /github/webhook");

  const shutdown = async (signal: string) => {
    console.log(`${signal}: shutting down`);
    sync?.stop();
    await orchestrator.shutdown();
    await app?.close();
    await store.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  await orchestrator.start();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
