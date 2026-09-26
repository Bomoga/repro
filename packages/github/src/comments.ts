import type { Octokit } from "@octokit/rest";
import type { TrustReport } from "@repro/api";
import type { Patch } from "@repro/contracts";

export interface PrTarget {
  owner: string;
  repo: string;
  pullNumber: number;
}

const MARKER = "<!-- repro:trust-report -->";

/** Posts the Trust Report as a PR comment, or updates the one it already posted (keyed by the
 *  HTML marker) rather than piling up a new comment per Run event. */
export async function upsertTrustReportComment(octokit: Octokit, target: PrTarget, patch: Patch, report: TrustReport, prBody: string): Promise<void> {
  const body = [
    MARKER,
    `### Trust Report for \`${patch.id}\`: ${report.confidence}`,
    ...report.reasons.map((r) => `- ${r}`),
    "",
    "<details><summary>Drafted PR description</summary>",
    "",
    prBody,
    "",
    "</details>",
  ].join("\n");

  const comments = await octokit.issues.listComments({ owner: target.owner, repo: target.repo, issue_number: target.pullNumber });
  const existing = comments.data.find((c) => c.body?.includes(MARKER));

  if (existing) {
    await octokit.issues.updateComment({ owner: target.owner, repo: target.repo, comment_id: existing.id, body });
  } else {
    await octokit.issues.createComment({ owner: target.owner, repo: target.repo, issue_number: target.pullNumber, body });
  }
}

/** Applies the narrated body to the PR description itself, when the patch already has one
 *  open (prUrl set). Lane 4 never opens the PR -- Repair/the orchestrator does that. */
export async function updatePrBody(octokit: Octokit, target: PrTarget, body: string): Promise<void> {
  await octokit.pulls.update({ owner: target.owner, repo: target.repo, pull_number: target.pullNumber, body });
}
