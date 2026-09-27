import { execFile } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Workspace } from "@repro/contracts";

const execFileAsync = promisify(execFile);

/** Makes and removes the workspace copies that let a Run repair several Diagnoses at once. */
export interface WorkspaceCopies {
  /** A copy of `workspace` for one Diagnosis: the same Workspace at its own path, checked out at headCommit. */
  copy(workspace: Workspace, name: string): Promise<Workspace>;
  /** Removes a copy `copy` made. */
  remove(copy: Workspace): void | Promise<void>;
}

// Ingest's git settings (packages/ingest/src/repo-adapter.ts), so a copy's tree is byte for byte what
// Ingest checked out, on Windows too: the user's and the system's git config are ignored, so no
// core.autocrlf rewrites line endings and a Patch.diff made in a copy applies to headCommit anywhere.
// Symlinks check out as plain files, and hooks, fsmonitor, and LFS smudge filters stay off.
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
    const { stdout } = await execFileAsync("git", [...GIT_CONFIG, ...args], { cwd, env: GIT_ENV, maxBuffer: 256 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`git ${args[0]} failed while copying the workspace: ${(e.stderr ?? e.message).trim()}`);
  }
}

const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const SHA = /^[0-9a-f]{7,64}$/i;

/**
 * Clones the Run's workspace, the way Ingest clones a local target, to
 * `<the workspace's parent>/repairs/<name>/repo`, and checks out headCommit. Repair resets and edits
 * its own copy's tree, so Diagnoses in flight at once never see each other's edits, and the copy
 * sits beside the workspace, where the sandbox can mount it.
 */
export async function copyWorkspace(workspace: Workspace, name: string): Promise<Workspace> {
  if (!SAFE_NAME.test(name)) throw new Error(`unsafe workspace copy name: ${name}`);
  if (!SHA.test(workspace.headCommit)) throw new Error(`Workspace.headCommit must be a commit SHA, got: ${workspace.headCommit}`);
  const dest = join(dirname(workspace.path), "repairs", name, "repo");
  if (existsSync(dest)) throw new Error(`a workspace copy already exists at ${dest}`);
  mkdirSync(dirname(dest), { recursive: true });
  try {
    await git(["clone", "--quiet", "--no-hardlinks", "--no-checkout", "--", workspace.path, dest]);
    await git(["checkout", "--quiet", "--detach", workspace.headCommit], dest);
    const head = (await git(["rev-parse", "HEAD"], dest)).trim();
    if (head !== workspace.headCommit) throw new Error(`the copy checked out ${head}, not ${workspace.headCommit}`);
    return { ...workspace, path: realpathSync(dest) };
  } catch (error) {
    rmSync(dirname(dest), { recursive: true, force: true });
    throw error;
  }
}

/** Removes a copy made by copyWorkspace. Safe to call more than once. */
export function removeWorkspaceCopy(copy: Workspace): void {
  rmSync(dirname(copy.path), { recursive: true, force: true, maxRetries: 3 });
}

export const gitWorkspaceCopies: WorkspaceCopies = { copy: copyWorkspace, remove: removeWorkspaceCopy };
