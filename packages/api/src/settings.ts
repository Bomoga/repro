// Settings the dashboard can change while the control plane runs. They live in this process, so
// they reach the orchestrator only when it shares the process with the API (npm run
// control-plane), and are saved to REPRO_SETTINGS_FILE (default ~/.config/repro/settings.json) so
// a restart keeps them. With nothing saved, the environment's values apply.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where verified patches go: auto (a GitHub PR where the token can push, else a local branch), github, or local only. */
export type PullRequestMode = "auto" | "github" | "local";

export const PULL_REQUEST_MODES: readonly PullRequestMode[] = ["auto", "github", "local"];

export function pullRequestModeFromEnv(env: NodeJS.ProcessEnv = process.env): PullRequestMode {
  const raw = env.REPRO_PR_MODE?.trim() || "auto";
  if ((PULL_REQUEST_MODES as readonly string[]).includes(raw)) return raw as PullRequestMode;
  throw new Error(`REPRO_PR_MODE must be auto, github, or local, got "${raw}"`);
}

const settingsFile = () => process.env.REPRO_SETTINGS_FILE || join(process.env.HOME || homedir(), ".config", "repro", "settings.json");

function savedMode(): PullRequestMode | undefined {
  try {
    const saved = (JSON.parse(readFileSync(settingsFile(), "utf8")) as { pullRequestMode?: unknown }).pullRequestMode;
    return (PULL_REQUEST_MODES as readonly unknown[]).includes(saved) ? (saved as PullRequestMode) : undefined;
  } catch {
    return undefined;
  }
}

let pullRequestMode: PullRequestMode | undefined;

export const runtimeSettings = {
  /** The dashboard's last choice when one was saved, else REPRO_PR_MODE. */
  pullRequestMode(): PullRequestMode {
    return (pullRequestMode ??= savedMode() ?? pullRequestModeFromEnv());
  },
  setPullRequestMode(mode: PullRequestMode): PullRequestMode {
    pullRequestMode = mode;
    try {
      mkdirSync(dirname(settingsFile()), { recursive: true });
      writeFileSync(settingsFile(), JSON.stringify({ pullRequestMode: mode }, null, 2));
    } catch {
      // Unsaved, the choice still holds until the control plane restarts.
    }
    return mode;
  },
};
