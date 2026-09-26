import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Octokit } from "@octokit/rest";
import { createGeminiClient } from "@repro/agents";
import { buildApp, openRunStore } from "@repro/api";
import { DEFAULT_SANDBOX_IMAGE, DockerExecutor, sandboxAvailable } from "@repro/executor";
import { Orchestrator } from "./orchestrator.ts";
import { GitHubPullRequests } from "./pull-request.ts";
import { PullRequestSync } from "./pull-request-sync.ts";

// The control plane in one process: the API and the Run Orchestrator on the same Run Store, so
// the in-memory store works as well as Atlas. Environment (the repo-root .env is read first):
//   GEMINI_API_KEY          required: Diagnose, Repair, and the Challenger run on Gemini
//   MONGODB_URI             Lane 1's Atlas store (unset: in-memory, lost on restart)
//   MONGODB_DB              database name, when the URI doesn't name one
//   PORT, HOST              the API's listen address (default 127.0.0.1:4000)
//   REPRO_API=off           only the orchestrator, beside an API process on the same Atlas store
//   REPRO_GITHUB_TOKEN      open a PR for each verified Patch on a GitHub target (unset: no PRs),
//                           and poll those PRs so a merge or close on GitHub settles the Patch
//   REPRO_GITHUB_WEBHOOK_SECRET  also take GitHub's pull_request webhook at POST /github/webhook
//   REPRO_KEEP_WORKSPACES=1 keep each Run's workspace after it finishes

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set; Diagnose, Repair, and the Challenger need it.");
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
  const say = (line: string) => console.log(line);
  const orchestrator = new Orchestrator({
    store,
    executor,
    gemini: (log) => createGeminiClient({ log }),
    pullRequests: octokit ? new GitHubPullRequests(octokit, executor) : undefined,
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
  console.log(`orchestrator polling the ${store.kind} run store; pull requests ${token ? "on" : "off (set REPRO_GITHUB_TOKEN to open them)"}`);
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
