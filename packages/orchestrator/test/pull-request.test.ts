import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Octokit } from "@octokit/rest";
import type { GeminiClient } from "@repro/agents";
import type { ExecRequest, Executor } from "@repro/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubPullRequests, pullRequestBody, pullRequestTitle, type PullRequestInput } from "../src/pull-request.ts";
import { HEAD, aDiagnosis, aFinding, aPatch, aWorkspace } from "./helpers.ts";

const PATCHED = "const sql = 'SELECT * FROM notes WHERE id = $1';\n";

const narrator = (outputText: string): GeminiClient => ({
  interact: async () => ({ interactionId: "i1", model: "gemini-3.8-flash", status: "completed", outputText, functionCalls: [] }),
});

function input(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  const finding = aFinding("fnd_sqli", { reproducible: true, reproductionOutput: "REPRODUCED semgrep sqli at src/db.js:6-7" });
  const diagnosis = aDiagnosis("diag_sqli", ["fnd_sqli"]);
  return {
    run: { id: "run_1", trigger: "manual", target: { kind: "github", ref: "octo/example" }, stage: "verify", status: "running", startedAt: "2026-09-26T10:00:00.000Z", logRef: "run_logs/run_1" },
    workspace: aWorkspace({ runId: "run_1" }),
    patch: aPatch("patch_2", "diag_sqli", { challengerVerdict: "confirmed", challengerNotes: "Counter-test failed before, passes after.", status: "verified" }),
    diagnosis,
    findings: [finding, aFinding("fnd_other")],
    gemini: narrator("Both queries now bind the caller's value instead of splicing it into SQL."),
    ...overrides,
  };
}

describe("pullRequestTitle and pullRequestBody", () => {
  it("titles the PR from the cited rules and the changed files, never from model prose", () => {
    expect(pullRequestTitle(input())).toBe("Repro: fix node-postgres-sqli in src/db.js");
  });

  it("labels the narration as Gemini's and pastes the proof verbatim", () => {
    const body = pullRequestBody(input(), "Both queries now bind the caller's value.", true);
    expect(body.startsWith("Both queries now bind the caller's value.")).toBe(true);
    expect(body).toContain("Written by Gemini from the evidence below");
    expect(body).toContain("## Proof");
    expect(body).toContain("```text\nconst sql = 'SELECT * FROM notes WHERE id = ' + id;\n```");
    expect(body).toContain("Reproduced with `repro-semgrep-rule registry sqli src/db.js`:");
    expect(body).toContain("```text\nREPRODUCED semgrep sqli at src/db.js:6-7\n```");
    expect(body).toContain("```text\nNOT REPRODUCED semgrep sqli in src/db.js\n```");
    expect(body).toContain("- Tests: pass");
    expect(body).toContain("- New findings in the changed files: none");
    expect(body).toContain("- Challenger: confirmed. Counter-test failed before, passes after.");
    expect(body).toContain("### Trust Report: high");
    expect(body).not.toContain("fnd_other");
  });

  it("doesn't claim Gemini wrote a templated body, and fences evidence that contains backticks", () => {
    const tricky = aFinding("fnd_sqli", { evidence: "const md = ```sql\n``` + id;" });
    const body = pullRequestBody(input({ findings: [tricky] }), "Template.", false);
    expect(body).not.toContain("Written by Gemini");
    expect(body).toContain("````text\nconst md = ```sql\n``` + id;\n````");
  });
});

describe("GitHubPullRequests", () => {
  let root: string;
  let workspacePath: string;
  let commands: string[];
  let executor: Executor;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "repro-pr-"));
    workspacePath = join(root, "repo");
    mkdirSync(join(workspacePath, "src"), { recursive: true });
    writeFileSync(join(workspacePath, "src", "db.js"), "const sql = 'SELECT * FROM notes WHERE id = ' + id;\n");
    writeFileSync(join(workspacePath, "src", "old.js"), "module.exports = 1;\n");
    commands = [];
    // Stands in for the sandbox: applying the diff rewrites db.js and deletes old.js.
    executor = {
      exec: vi.fn(async ({ command }: ExecRequest) => {
        commands.push(command);
        if (command.includes(" apply ")) {
          expect(existsSync(join(workspacePath, ".repro-pr.diff"))).toBe(true);
          writeFileSync(join(workspacePath, "src", "db.js"), PATCHED);
          rmSync(join(workspacePath, "src", "old.js"));
        }
        const stdout = command.startsWith("git ls-tree") ? "100755 blob 1111\tsrc/db.js\u0000100644 blob 2222\tsrc/old.js\u0000" : "";
        return { exitCode: 0, stdout, stderr: "", timedOut: false, durationMs: 1 };
      }),
    };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function fakeOctokit() {
    const calls = {
      createBlob: vi.fn(async () => ({ data: { sha: "blob_db" } })),
      getCommit: vi.fn(async () => ({ data: { tree: { sha: "tree_head" } } })),
      createTree: vi.fn(async () => ({ data: { sha: "tree_new" } })),
      createCommit: vi.fn(async () => ({ data: { sha: "commit_new" } })),
      createRef: vi.fn(async () => ({ data: {} })),
      getRepo: vi.fn(async () => ({ data: { default_branch: "main" } })),
      createPull: vi.fn(async (_pull: { base: string; head: string; title: string; body: string }) => ({ data: { html_url: "https://github.com/octo/example/pull/9" } })),
    };
    const octokit = {
      git: { createBlob: calls.createBlob, getCommit: calls.getCommit, createTree: calls.createTree, createCommit: calls.createCommit, createRef: calls.createRef },
      repos: { get: calls.getRepo },
      pulls: { create: calls.createPull },
    } as unknown as Octokit;
    return { octokit, calls };
  }

  const verified = () =>
    input({
      workspace: aWorkspace({ runId: "run_1", path: workspacePath }),
      patch: aPatch("patch_2", "diag_sqli", { filesChanged: ["src/db.js", "src/old.js"], challengerVerdict: "confirmed", status: "verified" }),
    });

  it("commits the verified patch onto headCommit, pushes a branch, and opens the PR against the default branch", async () => {
    const { octokit, calls } = fakeOctokit();
    const url = await new GitHubPullRequests(octokit, executor).open(verified());

    expect(url).toBe("https://github.com/octo/example/pull/9");
    expect(commands[0]).toBe(`git -c core.quotepath=off reset --hard --quiet ${HEAD}`);
    expect(calls.createBlob).toHaveBeenCalledWith({ owner: "octo", repo: "example", content: Buffer.from(PATCHED).toString("base64"), encoding: "base64" });
    expect(calls.getCommit).toHaveBeenCalledWith({ owner: "octo", repo: "example", commit_sha: HEAD });
    expect(calls.createTree).toHaveBeenCalledWith({
      owner: "octo",
      repo: "example",
      base_tree: "tree_head",
      tree: [
        { path: "src/db.js", mode: "100755", type: "blob", sha: "blob_db" },
        { path: "src/old.js", mode: "100644", type: "blob", sha: null },
      ],
    });
    expect(calls.createCommit).toHaveBeenCalledWith(expect.objectContaining({ tree: "tree_new", parents: [HEAD] }));
    expect(calls.createRef).toHaveBeenCalledWith({ owner: "octo", repo: "example", ref: "refs/heads/repro/patch_2", sha: "commit_new" });
    const pull = calls.createPull.mock.calls[0]![0];
    expect(pull).toMatchObject({ base: "main", head: "repro/patch_2", title: "Repro: fix node-postgres-sqli in src/db.js, src/old.js" });
    expect(pull.body).toContain("Both queries now bind the caller's value");
    expect(pull.body).toContain("Written by Gemini");
    expect(existsSync(join(workspacePath, ".repro-pr.diff"))).toBe(false);
  });

  it("targets the branch the run scanned, when it named one", async () => {
    const { octokit, calls } = fakeOctokit();
    const scanned = verified();
    scanned.run = { ...scanned.run, target: { kind: "github", ref: "octo/example#develop" } };
    await new GitHubPullRequests(octokit, executor).open(scanned);
    expect(calls.getRepo).not.toHaveBeenCalled();
    expect(calls.createPull.mock.calls[0]![0]).toMatchObject({ base: "develop" });
  });

  it("opens nothing for a local target, and refuses a patch that changes CI workflows", async () => {
    const { octokit, calls } = fakeOctokit();
    const prs = new GitHubPullRequests(octokit, executor);
    const local = verified();
    local.run = { ...local.run, target: { kind: "local", ref: "/repos/demo" } };
    expect(await prs.open(local)).toBeUndefined();

    const ci = verified();
    ci.patch = { ...ci.patch, filesChanged: [".github/workflows/ci.yml"] };
    await expect(prs.open(ci)).rejects.toThrow(/\.github\/workflows\/ci\.yml.*secrets/);
    expect(calls.createRef).not.toHaveBeenCalled();
    expect(commands).toEqual([]);
  });
});
