import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecRequest, ExecResult, Executor, Workspace } from "@repro/contracts";

export const FIXTURES = join(import.meta.dirname, "fixtures");
export const SEEDED = join(FIXTURES, "seeded-target");

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

// A workspace over the seeded fixture tree, for parsing tests that read evidence but never exec.
export const seededWorkspace: Workspace = {
  runId: "run-test",
  path: SEEDED,
  fileIndex: [
    "app/jobs.py",
    "assistant/chat.ts",
    "assistant/memory.py",
    "package-lock.json",
    "package.json",
    "requirements.txt",
    "server/config.js",
    "server/index.js",
  ],
  languages: ["javascript", "python", "typescript"],
  headCommit: "0".repeat(40),
};

// Scripted Executor: answers each request from a handler and records what it was asked to run.
export class FakeExecutor implements Executor {
  readonly requests: ExecRequest[] = [];
  constructor(private readonly handler: (req: ExecRequest) => Partial<ExecResult> | Promise<Partial<ExecResult>>) {}

  async exec(req: ExecRequest): Promise<ExecResult> {
    this.requests.push(req);
    const r = await this.handler(req);
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1, ...r };
  }
}
