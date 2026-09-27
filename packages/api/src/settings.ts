// Settings the dashboard can change while the control plane runs. They live in this process, so
// they reach the orchestrator only when it shares the process with the API (npm run
// control-plane); a restart goes back to the environment's values.

/** Where verified patches go: auto (a GitHub PR where the token can push, else a local branch), github, or local only. */
export type PullRequestMode = "auto" | "github" | "local";

export const PULL_REQUEST_MODES: readonly PullRequestMode[] = ["auto", "github", "local"];

export function pullRequestModeFromEnv(env: NodeJS.ProcessEnv = process.env): PullRequestMode {
  const raw = env.REPRO_PR_MODE?.trim() || "auto";
  if ((PULL_REQUEST_MODES as readonly string[]).includes(raw)) return raw as PullRequestMode;
  throw new Error(`REPRO_PR_MODE must be auto, github, or local, got "${raw}"`);
}

let pullRequestMode: PullRequestMode | undefined;

export const runtimeSettings = {
  pullRequestMode(): PullRequestMode {
    return (pullRequestMode ??= pullRequestModeFromEnv());
  },
  setPullRequestMode(mode: PullRequestMode): PullRequestMode {
    pullRequestMode = mode;
    return mode;
  },
};
