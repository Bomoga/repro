import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Diagnosis, Finding, Patch, Run, Workspace } from "@repro/contracts";
import { LocalBranches, RoutedPullRequests, pullRequestModeFromEnv } from "../src/local-branches.ts";
import type { PullRequestInput, PullRequestOpener } from "../src/pull-request.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

function target(kind: Run["target"]["kind"] = "github", ref = "someone/else"): PullRequestInput {
  const repo = mkdtempSync(join(tmpdir(), "repro-target-"));
  git(repo, "init", "-q");
  writeFileSync(join(repo, "db.js"), "query(\"SELECT \" + id);\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "seed");
  const headCommit = git(repo, "rev-parse", "HEAD");
  const diff = ["diff --git a/db.js b/db.js", "--- a/db.js", "+++ b/db.js", "@@ -1 +1 @@", '-query("SELECT " + id);', '+query("SELECT $1", [id]);', ""].join("\n");
  const finding = { id: "f1", ruleId: "sqli", file: "db.js" } as Finding;
  return {
    run: { id: "run_1", target: { kind, ref } } as Run,
    workspace: { runId: "run_1", path: repo, headCommit, fileIndex: ["db.js"], languages: ["javascript"] } as Workspace,
    patch: { id: "patch_abcdef123", diagnosisId: "d1", diff, filesChanged: ["db.js"], status: "verified" } as Patch,
    diagnosis: { id: "d1", findingIds: ["f1"] } as Diagnosis,
    findings: [finding],
    gemini: {} as PullRequestInput["gemini"],
  };
}

describe("LocalBranches", () => {
  it("commits a verified patch on its own branch in a local clone, based on the scanned commit", async () => {
    const root = mkdtempSync(join(tmpdir(), "repro-branches-"));
    const input = target();
    const url = await new LocalBranches(root).open(input);

    const clone = join(root, "someone__else");
    expect(url).toBe(`file://${clone}#repro/patch_ab`);
    expect(git(clone, "rev-parse", "--abbrev-ref", "HEAD")).toBe("repro/patch_ab");
    expect(git(clone, "rev-parse", "HEAD^")).toBe(input.workspace.headCommit);
    expect(readFileSync(join(clone, "db.js"), "utf8")).toBe('query("SELECT $1", [id]);\n');
    expect(git(clone, "log", "-1", "--format=%s")).toBe("Repro: fix sqli in db.js");
  });
});

describe("RoutedPullRequests", () => {
  const openers = () => {
    const local: PullRequestOpener = { open: vi.fn(async () => "file://local") };
    const github: PullRequestOpener = { open: vi.fn(async () => "https://github.com/pr/1") };
    return { local, github };
  };
  const octokit = (push: boolean) => ({ repos: { get: vi.fn(async () => ({ data: { permissions: { push } } })) } }) as never;

  it("auto: a GitHub PR where the token can push, a local branch on someone else's repo", async () => {
    const own = openers();
    expect(await new RoutedPullRequests("auto", own.local, own.github, octokit(true)).open(target())).toBe("https://github.com/pr/1");
    const theirs = openers();
    expect(await new RoutedPullRequests("auto", theirs.local, theirs.github, octokit(false)).open(target())).toBe("file://local");
  });

  it("local always stays local; local targets and a missing token never go to GitHub", async () => {
    const o = openers();
    expect(await new RoutedPullRequests("local", o.local, o.github, octokit(true)).open(target())).toBe("file://local");
    expect(await new RoutedPullRequests("github", o.local, o.github, octokit(true)).open(target("local", "/src/app"))).toBe("file://local");
    expect(await new RoutedPullRequests("auto", o.local, undefined, undefined).open(target())).toBe("file://local");
  });

  it("reads REPRO_PR_MODE, defaulting to auto", () => {
    expect(pullRequestModeFromEnv({})).toBe("auto");
    expect(pullRequestModeFromEnv({ REPRO_PR_MODE: "local" })).toBe("local");
    expect(() => pullRequestModeFromEnv({ REPRO_PR_MODE: "yolo" })).toThrow("REPRO_PR_MODE");
  });
});
