import type { Octokit } from "@octokit/rest";
import type { Run } from "@repro/contracts";

const CHECK_NAME = "repro/run";

// Section 11: the Run's own stage/status is the single source of truth for what gets reported;
// this is a projection, never a second opinion.
function toCheckRun(run: Run): { status: "queued" | "in_progress" | "completed"; conclusion?: string; title: string } {
  if (run.status === "completed") return { status: "completed", conclusion: "success", title: `Run ${run.id} completed` };
  if (run.status === "failed") return { status: "completed", conclusion: "failure", title: `Run ${run.id} failed at ${run.stage}` };
  if (run.status === "blocked") return { status: "completed", conclusion: "neutral", title: `Run ${run.id} blocked at ${run.stage}` };
  if (run.status === "running") return { status: "in_progress", title: `Run ${run.id} running (${run.stage})` };
  return { status: "queued", title: `Run ${run.id} queued` };
}

export interface CheckRunTarget {
  owner: string;
  repo: string;
  headSha: string;
}

/** Creates the Check Run on first report for a given (repo, sha, run), then updates the same
 *  Check Run on every subsequent stage transition, keyed by an external_id of the Run's id. */
export async function upsertRunCheck(octokit: Octokit, target: CheckRunTarget, run: Run): Promise<void> {
  const projection = toCheckRun(run);
  const existing = await octokit.checks.listForRef({
    owner: target.owner,
    repo: target.repo,
    ref: target.headSha,
    check_name: CHECK_NAME,
  });
  const match = existing.data.check_runs.find((c) => c.external_id === run.id);

  const payload = {
    owner: target.owner,
    repo: target.repo,
    name: CHECK_NAME,
    head_sha: target.headSha,
    external_id: run.id,
    status: projection.status,
    conclusion: projection.conclusion as never,
    output: { title: projection.title, summary: `stage: ${run.stage}\nstatus: ${run.status}` },
  };

  if (match) {
    await octokit.checks.update({ ...payload, check_run_id: match.id });
  } else {
    await octokit.checks.create(payload);
  }
}
