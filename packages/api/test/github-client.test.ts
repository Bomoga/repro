import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "@octokit/rest";
import { GitHubClient } from "../src/github/client.js";

function fakeOctokit() {
  return {
    rest: {
      issues: {
        createComment: vi.fn().mockResolvedValue({ data: { id: 1, html_url: "https://github.com/o/r/issues/1#c1" } }),
      },
      checks: {
        create: vi.fn().mockResolvedValue({ data: { id: 2, html_url: "https://github.com/o/r/checks/2" } }),
      },
      repos: {
        createCommitStatus: vi.fn().mockResolvedValue({ data: { id: 3, url: "https://api.github.com/status/3" } }),
      },
    },
  };
}

describe("GitHubClient", () => {
  it("posts a PR comment", async () => {
    const octokit = fakeOctokit();
    const client = new GitHubClient(undefined, octokit as unknown as Octokit);
    const result = await client.postPrComment({ owner: "o", repo: "r" }, 1, "hello");
    expect(result).toEqual({ id: 1, url: "https://github.com/o/r/issues/1#c1" });
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      issue_number: 1,
      body: "hello",
    });
  });

  it("creates a check run with the given conclusion", async () => {
    const octokit = fakeOctokit();
    const client = new GitHubClient(undefined, octokit as unknown as Octokit);
    await client.upsertCheckRun(
      { owner: "o", repo: "r" },
      { name: "repro/verify", headSha: "abc", status: "completed", conclusion: "success", title: "Verified", summary: "All checks passed" },
    );
    expect(octokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "repro/verify", head_sha: "abc", conclusion: "success" }),
    );
  });

  it("sets a commit status", async () => {
    const octokit = fakeOctokit();
    const client = new GitHubClient(undefined, octokit as unknown as Octokit);
    await client.setCommitStatus({ owner: "o", repo: "r" }, { sha: "abc", state: "success", context: "repro", description: "ok" });
    expect(octokit.rest.repos.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "abc", state: "success", context: "repro" }),
    );
  });
});
