import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACES_ROOT } from "@repro/executor";
import { IngestError, detectLanguages, ingest, parseGithubRef, parseLocalRef, removeWorkspace } from "../src/index.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();

describe("ref parsing", () => {
  it("parses GitHub shorthand and URLs", () => {
    expect(parseGithubRef("octo/demo")).toEqual({ owner: "octo", repo: "demo", rev: undefined });
    expect(parseGithubRef("https://github.com/octo/demo.git#v1.2")).toEqual({ owner: "octo", repo: "demo", rev: "v1.2" });
  });

  it("rejects refs that could be read as git options", () => {
    expect(() => parseGithubRef("octo/demo#--upload-pack=x")).toThrow(IngestError);
    expect(() => parseLocalRef("/tmp/x#-evil")).toThrow(IngestError);
    expect(() => parseGithubRef("not a ref")).toThrow(IngestError);
  });
});

describe("detectLanguages", () => {
  it("maps extensions to sorted, unique languages", () => {
    expect(detectLanguages(["a.ts", "b.tsx", "c.py", "d.js", "Dockerfile", "README.md"])).toEqual([
      "dockerfile",
      "javascript",
      "python",
      "typescript",
    ]);
  });
});

describe("ingest (local)", () => {
  let source: string;
  let root: string;
  let firstCommit: string;

  beforeAll(() => {
    source = mkdtempSync(join(tmpdir(), "repro-src-"));
    mkdirSync(DEFAULT_WORKSPACES_ROOT, { recursive: true });
    root = mkdtempSync(join(DEFAULT_WORKSPACES_ROOT, "ingest-test-"));
    git(source, "init", "-q");
    mkdirSync(join(source, "app"));
    writeFileSync(join(source, "app", "main.py"), "print('hi')\n");
    writeFileSync(join(source, "index.ts"), "export const x = 1;\n");
    symlinkSync("/etc/hosts", join(source, "hosts-link"));
    git(source, "add", "-A");
    git(source, "commit", "-qm", "one");
    firstCommit = git(source, "rev-parse", "HEAD");
  });

  afterAll(() => {
    rmSync(source, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("produces a Workspace pinned to the source's HEAD", async () => {
    const ws = await ingest("run-a", { kind: "local", ref: source }, { workspacesRoot: root });
    expect(ws.runId).toBe("run-a");
    expect(ws.headCommit).toBe(firstCommit);
    expect(ws.fileIndex.sort()).toEqual(["app/main.py", "hosts-link", "index.ts"]);
    expect(ws.languages).toEqual(["python", "typescript"]);
    expect(git(ws.path, "rev-parse", "HEAD")).toBe(firstCommit);
  });

  it("checks symlinks out as plain files, so they can't reach outside the workspace", async () => {
    const ws = await ingest("run-b", { kind: "local", ref: source }, { workspacesRoot: root });
    expect(lstatSync(join(ws.path, "hosts-link")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(ws.path, "hosts-link"), "utf8")).toBe("/etc/hosts");
  });

  it("keeps its own headCommit when the upstream target moves", async () => {
    const ws = await ingest("run-c", { kind: "local", ref: source }, { workspacesRoot: root });
    writeFileSync(join(source, "later.py"), "x = 2\n");
    git(source, "add", "-A");
    git(source, "commit", "-qm", "two");
    expect(git(ws.path, "rev-parse", "HEAD")).toBe(firstCommit);
    expect(ws.fileIndex).not.toContain("later.py");

    const pinned = await ingest("run-d", { kind: "local", ref: `${source}#${firstCommit}` }, { workspacesRoot: root });
    expect(pinned.headCommit).toBe(firstCommit);
  });

  it("refuses to overwrite an existing workspace, and cleans up after failures", async () => {
    await expect(ingest("run-a", { kind: "local", ref: source }, { workspacesRoot: root })).rejects.toThrow(IngestError);
    await expect(ingest("run-e", { kind: "local", ref: join(source, "nope") }, { workspacesRoot: root })).rejects.toThrow(
      IngestError,
    );
    await expect(ingest("../escape", { kind: "local", ref: source }, { workspacesRoot: root })).rejects.toThrow(IngestError);
  });

  it("removes a workspace", async () => {
    const ws = await ingest("run-f", { kind: "local", ref: source }, { workspacesRoot: root });
    removeWorkspace(ws);
    expect(() => lstatSync(ws.path)).toThrow();
  });
});

// Hits github.com; opt in with REPRO_NETWORK_TESTS=1.
describe.skipIf(!process.env.REPRO_NETWORK_TESTS)("ingest (github)", () => {
  it("shallow-clones a public repo at a pinned ref", async () => {
    const root = mkdtempSync(join(DEFAULT_WORKSPACES_ROOT, "ingest-gh-"));
    try {
      const ws = await ingest("run-gh", { kind: "github", ref: "octocat/Hello-World#master" }, { workspacesRoot: root });
      expect(ws.headCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(ws.fileIndex).toContain("README");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
