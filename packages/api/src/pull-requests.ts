import { StoreError, type RunStore } from "./store/index.ts";

export interface PullRequestClosed {
  /** The PR's html_url, as the orchestrator stored it in Patch.prUrl. */
  url: string;
  merged: boolean;
  /** How the news arrived, for the Run's log. */
  source: "webhook" | "poll";
}

export type PullRequestOutcome = "merged" | "rejected" | "unknown";

/**
 * A person merged or closed a repair PR on GitHub, so its Patch becomes merged or rejected
 * (section 4: only a human merging the PR sets merged). The PR is matched by its URL to a verified
 * Patch still awaiting that decision. Anything else, a PR Repro didn't open or one already settled,
 * is "unknown", so a redelivered webhook, or a poll racing the webhook, changes nothing.
 */
export async function recordPullRequestClosed(store: RunStore, pr: PullRequestClosed): Promise<PullRequestOutcome> {
  const open = (await store.listOpenPullRequests()).find(({ patch }) => patch.prUrl === pr.url);
  if (!open) return "unknown";
  try {
    await store.setPatchDecision(open.patch.id, pr.merged ? "merge" : "reject");
  } catch (error) {
    // The other path settled it between the lookup and this write.
    if (error instanceof StoreError && error.code === "CONFLICT") return "unknown";
    throw error;
  }
  await store.appendLog(open.runId, "github", {
    event: pr.merged ? "pull-request-merged" : "pull-request-closed",
    patchId: open.patch.id,
    prUrl: pr.url,
    source: pr.source,
  });
  return pr.merged ? "merged" : "rejected";
}
