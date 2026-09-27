import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Octokit } from "@octokit/rest";
import type { PullRequestMode } from "@repro/api";
import { parseGithubRef } from "@repro/ingest";
import { pullRequestTitle, type PullRequestInput, type PullRequestOpener } from "./pull-request.ts";

const run = promisify(execFile);
const git = (args: string[], cwd?: string) => run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });

/** Where verified patches land as local branches, one clone per target. */
export const LOCAL_BRANCHES_ROOT = process.env.REPRO_LOCAL_BRANCHES_DIR ?? join(homedir(), ".repro", "local-branches");

function slug(ref: string): string {
  return ref.replace(/^https:\/\/github\.com\//, "").replace(/[^A-Za-z0-9._-]+/g, "__").replace(/^_+|_+$/g, "") || "target";
}

/**
 * The local git system instead of a GitHub PR: each verified patch becomes a commit on its own
 * branch (repro/<patch>) in a clone kept under ~/.repro/local-branches, based on the exact commit
 * the run scanned. Only git runs here, on the host, applying the recorded diff: no target code.
 * Returns a file:// URL naming the clone and branch.
 */
export class LocalBranches implements PullRequestOpener {
  constructor(private readonly root: string = LOCAL_BRANCHES_ROOT) {}

  async open(input: PullRequestInput): Promise<string | undefined> {
    const { run: target, workspace, patch } = input;
    if (patch.status !== "verified") throw new Error(`patch ${patch.id} is ${patch.status}; only a verified patch gets a branch`);
    const dest = join(this.root, slug(target.target.ref));
    mkdirSync(this.root, { recursive: true });
    if (!existsSync(join(dest, ".git"))) await git(["clone", "--quiet", "--no-hardlinks", "--", workspace.path, dest]);
    await git(["fetch", "--quiet", "--", workspace.path, workspace.headCommit], dest);

    const branch = `repro/${patch.id.slice(0, 8)}`;
    await git(["checkout", "--quiet", "-B", branch, workspace.headCommit], dest);
    const scratch = mkdtempSync(join(tmpdir(), "repro-patch-"));
    try {
      const file = join(scratch, "patch.diff");
      writeFileSync(file, patch.diff.endsWith("\n") ? patch.diff : `${patch.diff}\n`);
      await git(["apply", "--index", "--", file], dest);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    await git(["-c", "user.name=Repro", "-c", "user.email=repro@localhost", "commit", "--quiet", "--no-verify", "-m", pullRequestTitle(input)], dest);
    return `file://${dest}#${branch}`;
  }
}

export { pullRequestModeFromEnv, type PullRequestMode } from "@repro/api";

/**
 * Picks where each verified patch goes. github: a GitHub PR (needs REPRO_GITHUB_TOKEN). local: a
 * local branch. auto: a GitHub PR when the token can push to the target repo, otherwise (someone
 * else's repo, no token, or a local target) a local branch.
 */
export class RoutedPullRequests implements PullRequestOpener {
  private readonly canPush = new Map<string, Promise<boolean>>();

  constructor(
    /** Read for every patch, so the dashboard can switch it while the control plane runs. */
    private readonly mode: PullRequestMode | (() => PullRequestMode),
    private readonly local: PullRequestOpener,
    private readonly github: PullRequestOpener | undefined,
    private readonly octokit: Octokit | undefined,
  ) {}

  async open(input: PullRequestInput): Promise<string | undefined> {
    return (await this.useGithub(input)) ? this.github!.open(input) : this.local.open(input);
  }

  private async useGithub(input: PullRequestInput): Promise<boolean> {
    const { target } = input.run;
    const mode = typeof this.mode === "function" ? this.mode() : this.mode;
    if (mode === "local" || target.kind !== "github" || !this.github) return false;
    if (mode === "github") return true;
    const { owner, repo } = parseGithubRef(target.ref);
    const key = `${owner}/${repo}`.toLowerCase();
    if (!this.canPush.has(key)) {
      this.canPush.set(
        key,
        this.octokit!.repos.get({ owner, repo }).then(
          ({ data }) => data.permissions?.push === true,
          () => false,
        ),
      );
    }
    return this.canPush.get(key)!;
  }
}
