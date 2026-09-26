import { Octokit } from "@octokit/rest";

export interface RepoRef {
  owner: string;
  repo: string;
}

export type CheckConclusion = "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required";
export type CheckStatus = "queued" | "in_progress" | "completed";

export interface CheckRunUpdate {
  name: string;
  headSha: string;
  status: CheckStatus;
  conclusion?: CheckConclusion;
  title: string;
  summary: string;
  detailsUrl?: string;
}

export interface CommitStatusUpdate {
  sha: string;
  state: "error" | "failure" | "pending" | "success";
  context: string;
  description: string;
  targetUrl?: string;
}

/**
 * The GitHub-facing half of the status surface (scope item 4): PR comments, Checks, and commit
 * status checks. A thin wrapper over Octokit so callers (the narrator, the CLI, tests) depend on
 * this interface rather than the SDK directly.
 */
export class GitHubClient {
  private readonly octokit: Octokit;

  constructor(auth: string | undefined = process.env.GITHUB_TOKEN, octokit?: Octokit) {
    this.octokit = octokit ?? new Octokit({ auth });
  }

  async postPrComment(ref: RepoRef, prNumber: number, body: string): Promise<{ id: number; url: string }> {
    const { data } = await this.octokit.rest.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: prNumber,
      body,
    });
    return { id: data.id, url: data.html_url };
  }

  async upsertCheckRun(ref: RepoRef, update: CheckRunUpdate): Promise<{ id: number; url: string }> {
    const { data } = await this.octokit.rest.checks.create({
      owner: ref.owner,
      repo: ref.repo,
      name: update.name,
      head_sha: update.headSha,
      status: update.status,
      conclusion: update.conclusion,
      details_url: update.detailsUrl,
      output: { title: update.title, summary: update.summary },
    });
    return { id: data.id, url: data.html_url ?? "" };
  }

  async setCommitStatus(ref: RepoRef, update: CommitStatusUpdate): Promise<{ id: number; url: string }> {
    const { data } = await this.octokit.rest.repos.createCommitStatus({
      owner: ref.owner,
      repo: ref.repo,
      sha: update.sha,
      state: update.state,
      context: update.context,
      description: update.description,
      target_url: update.targetUrl,
    });
    return { id: data.id, url: data.url };
  }
}
