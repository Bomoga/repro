import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Workspace } from "../../src/contracts.js";

export const DEMO_TARGET = fileURLToPath(new URL("../fixtures/demo-target", import.meta.url));

const GIT_ENV = {
  GIT_AUTHOR_NAME: "repro-fixture",
  GIT_AUTHOR_EMAIL: "fixture@repro.invalid",
  GIT_COMMITTER_NAME: "repro-fixture",
  GIT_COMMITTER_EMAIL: "fixture@repro.invalid",
  GIT_AUTHOR_DATE: "2026-09-26T10:00:00Z",
  GIT_COMMITTER_DATE: "2026-09-26T10:00:00Z",
};

/** Test-only host git, run against throwaway fixture repos this suite creates itself. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  });
}

export interface FixtureWorkspace {
  workspace: Workspace;
  cleanup(): void;
}

/** Copies the demo-target fixture into a fresh git repo, the way Ingest would hand it over. */
export function materializeWorkspace(runId = "run-test"): FixtureWorkspace {
  const dir = mkdtempSync(path.join(tmpdir(), "repro-ws-"));
  cpSync(DEMO_TARGET, dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture");
  const headCommit = git(dir, "rev-parse", "HEAD").trim();
  const fileIndex = git(dir, "ls-files").trim().split("\n");
  return {
    workspace: { runId, path: dir, fileIndex, languages: ["javascript"], headCommit },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
