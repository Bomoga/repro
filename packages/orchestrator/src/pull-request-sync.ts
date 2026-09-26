import type { Octokit } from "@octokit/rest";
import { recordPullRequestClosed, type RunStore } from "@repro/api";

const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/;

/**
 * Settles repair PRs a person merged or closed on GitHub by asking GitHub, for when its webhook
 * can't reach this process (a localhost demo without a tunnel). It uses the token the PRs were
 * opened with, and only to read their state. The webhook and this can both run: whichever sees a
 * merge first settles it, and the other finds nothing left to do.
 */
export class PullRequestSync {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private readonly store: RunStore,
    private readonly octokit: Octokit,
    private readonly say?: (line: string) => void,
  ) {}

  /** Checks every open repair PR once, and returns how many it settled. */
  async checkOnce(): Promise<number> {
    let settled = 0;
    for (const { runId, patch } of await this.store.listOpenPullRequests()) {
      const match = PR_URL.exec(patch.prUrl ?? "");
      if (!match) continue;
      const [, owner = "", repo = "", number = ""] = match;
      try {
        const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: Number(number) });
        if (data.state !== "closed") continue;
        const outcome = await recordPullRequestClosed(this.store, { url: patch.prUrl!, merged: data.merged === true, source: "poll" });
        if (outcome === "unknown") continue;
        settled++;
        this.say?.(`[${runId}] ${patch.prUrl} was ${data.merged ? "merged" : "closed without merging"}: patch ${patch.id} is ${outcome}`);
      } catch (error) {
        this.say?.(`[${runId}] couldn't check ${patch.prUrl}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return settled;
  }

  /** Checks every `intervalMs` until `stop()`. */
  start(intervalMs = 10_000): void {
    const tick = async () => {
      try {
        await this.checkOnce();
      } catch (error) {
        this.say?.(`pull request sync: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!this.stopped) this.timer = setTimeout(tick, intervalMs);
    };
    this.timer = setTimeout(tick, intervalMs);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
