import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Sandbox } from "@repro/agents";
import type { Workspace } from "@repro/contracts";
import { DEFAULT_WORKSPACES_ROOT, DockerExecutor, sandboxAvailable } from "@repro/executor";
import { ingest } from "@repro/ingest";
import { copyWorkspace, removeWorkspaceCopy } from "../src/workspace-copy.ts";

const GIT_ENV = {
  GIT_AUTHOR_NAME: "repro-fixture",
  GIT_AUTHOR_EMAIL: "fixture@repro.invalid",
  GIT_COMMITTER_NAME: "repro-fixture",
  GIT_COMMITTER_EMAIL: "fixture@repro.invalid",
};

/** Test-only host git over throwaway repos, reading bytes the way the sandbox's git does: no line-ending conversion. */
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });

const LF = "const a = 1;\nconst b = 2;\n";
const CRLF = "one\r\ntwo\r\n";

let root: string;
let workspace: Workspace;

beforeAll(async () => {
  // Under the workspaces root, so the sandbox can mount the copies.
  mkdirSync(DEFAULT_WORKSPACES_ROOT, { recursive: true });
  root = mkdtempSync(join(DEFAULT_WORKSPACES_ROOT, "copy-test-"));
  const source = join(root, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  git(source, "init", "-q");
  writeFileSync(join(source, "src", "calc.js"), LF);
  writeFileSync(join(source, "crlf.txt"), CRLF);
  git(source, "add", "-A");
  git(source, "commit", "-q", "-m", "fixture");
  workspace = await ingest("run_copy_test", { kind: "local", ref: source }, { workspacesRoot: join(root, "workspaces") });
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("copyWorkspace", () => {
  it("makes the same Workspace at its own path beside it, byte for byte, and removes it again", async () => {
    const first = await copyWorkspace(workspace, "01-diag_a");
    const second = await copyWorkspace(workspace, "02-diag_b");
    try {
      expect(first).toEqual({ ...workspace, path: first.path });
      expect(new Set([workspace.path, first.path, second.path]).size).toBe(3);
      for (const copy of [first, second]) {
        expect(copy.path.startsWith(dirname(workspace.path))).toBe(true);
        for (const file of workspace.fileIndex) expect(readFileSync(join(copy.path, file))).toEqual(readFileSync(join(workspace.path, file)));
        expect(readFileSync(join(copy.path, "crlf.txt"), "utf8")).toBe(CRLF); // no line-ending rewrite, on Windows included
        expect(git(copy.path, "rev-parse", "HEAD").trim()).toBe(workspace.headCommit);
        expect(git(copy.path, "status", "--porcelain")).toBe("");
      }

      // A patch made in one copy applies byte for byte to another and to the Run's own workspace.
      writeFileSync(join(first.path, "src", "calc.js"), LF.replace("b = 2", "b = 3"));
      const diff = git(first.path, "diff", "--no-color", workspace.headCommit);
      for (const target of [second.path, workspace.path]) {
        writeFileSync(join(target, "..", "fix.diff"), diff);
        git(target, "apply", join(target, "..", "fix.diff"));
        expect(git(target, "diff", "--no-color", workspace.headCommit)).toBe(diff);
        git(target, "checkout", "--", ".");
      }
    } finally {
      removeWorkspaceCopy(first);
      removeWorkspaceCopy(second);
    }
    expect(existsSync(dirname(first.path))).toBe(false);
    expect(existsSync(dirname(second.path))).toBe(false);
    expect(git(workspace.path, "status", "--porcelain")).toBe("");
  });

  it("refuses a name that could leave the copies' directory, and a second copy of the same name", async () => {
    await expect(copyWorkspace(workspace, "../escape")).rejects.toThrow(/unsafe workspace copy name/);
    const copy = await copyWorkspace(workspace, "03-twice");
    try {
      await expect(copyWorkspace(workspace, "03-twice")).rejects.toThrow(/already exists/);
    } finally {
      removeWorkspaceCopy(copy);
    }
  });
});

// Docker only, no Gemini: two copies, driven through the Sandbox exactly as Repair and the Challenger drive the Run's workspace.
const sandboxReady = await sandboxAvailable();

describe.skipIf(!sandboxReady)("workspace copies in the sandbox", () => {
  it("start clean at headCommit in the sandbox's eyes, and take a patch made in another copy", async () => {
    const executor = new DockerExecutor();
    const [first, second] = [await copyWorkspace(workspace, "04-sandbox_a"), await copyWorkspace(workspace, "05-sandbox_b")];
    try {
      const repairing = new Sandbox(first!, executor);
      const challenging = new Sandbox(second!, executor);
      expect(await repairing.diff()).toBe(""); // no line-ending or file-mode noise from the host's checkout
      expect(await challenging.diff()).toBe("");

      writeFileSync(join(first!.path, "src", "calc.js"), LF.replace("b = 2", "b = 3"));
      const patch = await repairing.diff();
      expect(patch).toContain("+const b = 3;");

      mkdirSync(join(second!.path, ".repro"));
      writeFileSync(join(second!.path, ".repro", "patch.diff"), patch);
      await challenging.resetToHead();
      await challenging.applyPatchFile(".repro/patch.diff");
      rmSync(join(second!.path, ".repro"), { recursive: true, force: true });
      expect(await challenging.diff()).toBe(patch);
    } finally {
      removeWorkspaceCopy(first!);
      removeWorkspaceCopy(second!);
    }
  }, 180_000);
});
