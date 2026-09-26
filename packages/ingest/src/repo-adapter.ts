import { execFile } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { type Run, Workspace } from "@repro/contracts";
import { DEFAULT_WORKSPACES_ROOT } from "@repro/executor";
import { detectLanguages } from "./languages.ts";

const execFileAsync = promisify(execFile);

export type Target = Run["target"];

export interface IngestOptions {
  // Parent directory for workspaces. Must be somewhere the Docker VM can bind-mount.
  workspacesRoot?: string;
}

export class IngestError extends Error {
  override name = "IngestError";
}

const SAFE_RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_REV = /^(?!-)[A-Za-z0-9._\/-]{1,255}$/;
const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;

// Every git call runs with the user's own git config ignored and with the settings that keep an
// untrusted repo from reaching outside its workspace: symlinks check out as plain files (so a
// link to ~/.ssh can't be read through the workspace), hooks and fsmonitor are off, and LFS
// smudge filters don't run.
const GIT_CONFIG = [
  "-c", "core.symlinks=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "protocol.file.allow=always",
  "-c", "advice.detachedHead=false",
];

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_LFS_SKIP_SMUDGE: "1",
};

async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...GIT_CONFIG, ...args], {
      cwd,
      env: GIT_ENV,
      maxBuffer: 256 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new IngestError(`git ${args[0]} failed: ${(e.stderr ?? e.message).trim()}`);
  }
}

// "owner/repo", "owner/repo#rev", or "https://github.com/owner/repo[.git][#rev]".
export function parseGithubRef(ref: string): { owner: string; repo: string; rev?: string } {
  const [spec = "", rev] = ref.split("#", 2);
  const path = spec.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  const [owner, repo, ...rest] = path.split("/");
  if (!owner || !repo || rest.length || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) {
    throw new IngestError(`not a GitHub ref (expected owner/repo[#rev]): ${ref}`);
  }
  if (rev !== undefined && !SAFE_REV.test(rev)) throw new IngestError(`unsafe revision: ${rev}`);
  return { owner, repo, rev };
}

// "/path/to/repo" or "/path/to/repo#rev". Only committed state is ingested: headCommit has to
// name a real commit, so uncommitted changes in a local checkout are not part of the run.
export function parseLocalRef(ref: string): { path: string; rev?: string } {
  const hash = ref.lastIndexOf("#");
  const path = hash === -1 ? ref : ref.slice(0, hash);
  const rev = hash === -1 ? undefined : ref.slice(hash + 1);
  if (!path) throw new IngestError(`empty local path: ${ref}`);
  if (rev !== undefined && !SAFE_REV.test(rev)) throw new IngestError(`unsafe revision: ${rev}`);
  return { path: resolve(path), rev };
}

async function cloneLocal(ref: string, dest: string): Promise<void> {
  const { path, rev } = parseLocalRef(ref);
  if (!existsSync(path)) throw new IngestError(`local path does not exist: ${path}`);
  await git(["rev-parse", "--git-dir"], path).catch(() => {
    throw new IngestError(`local path is not a git repository: ${path}`);
  });
  await git(["clone", "--quiet", "--no-hardlinks", "--no-checkout", "--", path, dest]);
  const sha = (await git(["rev-parse", "--verify", "--quiet", `${rev ?? "HEAD"}^{commit}`], dest)).trim();
  await git(["checkout", "--quiet", "--detach", sha], dest);
}

async function cloneGithub(ref: string, dest: string): Promise<void> {
  const { owner, repo, rev } = parseGithubRef(ref);
  mkdirSync(dest, { recursive: true });
  await git(["init", "--quiet"], dest);
  await git(["remote", "add", "origin", `https://github.com/${owner}/${repo}.git`], dest);
  await git(["fetch", "--quiet", "--depth", "1", "--no-tags", "origin", rev ?? "HEAD"], dest);
  await git(["checkout", "--quiet", "--detach", "FETCH_HEAD"], dest);
}

// Ingest: clone the target into a fresh workspace pinned to one commit, and snapshot its file
// index. Nothing downstream re-walks the tree or touches the target's original location again.
export async function ingest(runId: string, target: Target, options: IngestOptions = {}): Promise<Workspace> {
  if (!SAFE_RUN_ID.test(runId)) throw new IngestError(`unsafe runId: ${runId}`);
  const root = options.workspacesRoot ?? DEFAULT_WORKSPACES_ROOT;
  if (!isAbsolute(root)) throw new IngestError(`workspacesRoot must be absolute: ${root}`);
  const dest = join(root, runId, "repo");
  if (existsSync(dest)) throw new IngestError(`workspace already exists for run ${runId}: ${dest}`);
  mkdirSync(dirname(dest), { recursive: true });

  try {
    if (target.kind === "local") await cloneLocal(target.ref, dest);
    else await cloneGithub(target.ref, dest);

    const headCommit = (await git(["rev-parse", "HEAD"], dest)).trim();
    const fileIndex = (await git(["ls-files", "-z"], dest)).split("\0").filter(Boolean);
    return Workspace.parse({
      runId,
      path: realpathSync(dest),
      fileIndex,
      languages: detectLanguages(fileIndex),
      headCommit,
    });
  } catch (err) {
    rmSync(dirname(dest), { recursive: true, force: true });
    throw err;
  }
}

// Removes a run's workspace. Safe to call more than once.
export function removeWorkspace(workspace: Workspace): void {
  rmSync(dirname(workspace.path), { recursive: true, force: true });
}
