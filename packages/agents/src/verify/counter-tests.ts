import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ExecResult, Patch } from "../contracts.js";
import type { Sandbox } from "../sandbox.js";
import type { WorkspaceFiles } from "../workspace-files.js";

export const COUNTER_TEST_TIMEOUT_MS = 120_000;
const SCRATCH_DIR = ".repro";

/** A test the Challenger expects the patch to fail: it should pass only on correct code. */
export interface CounterTest {
  /** New, untracked, workspace-relative file the test is written to. */
  path: string;
  code: string;
  /** Command that runs the test from the workspace root, inside the sandbox. */
  command: string;
  description: string;
}

export type RunStatus = "pass" | "fail" | "timeout" | "error";

/**
 * Section 5's reading of a counter-test run against the original commit ("before") and the
 * patched tree ("after"). `no-signal` means it passed both times and probed nothing the
 * patch changed; `inconclusive` means the command itself couldn't run.
 */
export type CounterTestOutcome = "fix-holds" | "hole-open" | "regression" | "no-signal" | "inconclusive";

export interface CounterTestRun {
  test: CounterTest;
  before: { status: RunStatus; result: ExecResult };
  after: { status: RunStatus; result: ExecResult };
  outcome: CounterTestOutcome;
}

export function runStatus(result: ExecResult): RunStatus {
  if (result.timedOut) return "timeout";
  if (result.exitCode === 0) return "pass";
  // 126/127: the command couldn't be executed or found, which says nothing about the code.
  if (result.exitCode === 126 || result.exitCode === 127) return "error";
  return "fail";
}

/** The module or package a run failed to load, from Node's or Python's error, if that's why it failed. */
export function missingModule(result: ExecResult): string | undefined {
  const match = /Cannot find (?:module|package) '([^']+)'|No module named '([^']+)'/.exec(`${result.stdout}\n${result.stderr}`);
  return match ? (match[1] ?? match[2]) : undefined;
}

/**
 * A counter-test run's outcome from both results. When both runs fail to load the same module, the
 * test never reached the code on either tree (typically a package the sandbox can't install, having
 * no network), so it says nothing about the patch.
 */
export function outcomeOfRun(before: ExecResult, after: ExecResult): CounterTestOutcome {
  const [beforeStatus, afterStatus] = [runStatus(before), runStatus(after)];
  const missing = missingModule(before);
  if (beforeStatus === "fail" && afterStatus === "fail" && missing !== undefined && missing === missingModule(after)) return "inconclusive";
  return outcomeOf(beforeStatus, afterStatus);
}

export function outcomeOf(before: RunStatus, after: RunStatus): CounterTestOutcome {
  if (before === "error" || after === "error") return "inconclusive";
  const passedBefore = before === "pass";
  const passedAfter = after === "pass";
  if (!passedBefore && passedAfter) return "fix-holds";
  if (passedBefore && !passedAfter) return "regression";
  if (!passedBefore && !passedAfter) return "hole-open";
  return "no-signal";
}

export class CounterTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CounterTestError";
  }
}

/**
 * Runs counter-tests against both trees. The patched tree is always rebuilt from `Patch.diff`
 * (reset to headCommit, then `git apply`), so the Challenger attacks exactly the diff under
 * review, and whatever a test's command does to the tree is undone afterwards.
 */
export class CounterTestRunner {
  private readonly written = new Set<string>();
  private readonly createdDirs = new Set<string>();

  private constructor(
    private readonly sandbox: Sandbox,
    private readonly files: WorkspaceFiles,
    private readonly patch: Patch,
    private readonly patchFile: string,
  ) {}

  static async prepare(sandbox: Sandbox, files: WorkspaceFiles, patch: Patch): Promise<CounterTestRunner> {
    if (!/^[A-Za-z0-9._-]+$/.test(patch.id)) throw new CounterTestError(`unsafe Patch id: ${patch.id}`);
    const patchFile = `${SCRATCH_DIR}/${patch.id}.diff`;
    const absolute = path.join(sandbox.workspace.path, patchFile);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, patch.diff, "utf8");
    const runner = new CounterTestRunner(sandbox, files, patch, patchFile);
    await runner.restorePatched();
    return runner;
  }

  async run(test: CounterTest): Promise<CounterTestRun> {
    const target = await this.targetFor(test.path);
    await this.sandbox.resetToHead();
    await fs.writeFile(target, test.code, "utf8");
    const before = await this.sandbox.exec(test.command, COUNTER_TEST_TIMEOUT_MS);

    await this.restorePatched();
    await fs.writeFile(target, test.code, "utf8");
    const after = await this.sandbox.exec(test.command, COUNTER_TEST_TIMEOUT_MS);

    await fs.rm(target, { force: true });
    await this.restorePatched();
    return {
      test,
      before: { status: runStatus(before), result: before },
      after: { status: runStatus(after), result: after },
      outcome: outcomeOfRun(before, after),
    };
  }

  /** Leaves the workspace exactly at headCommit + Patch.diff, with every scratch file removed. */
  async dispose(): Promise<void> {
    for (const file of this.written) await fs.rm(path.join(this.sandbox.workspace.path, file), { force: true });
    const dirs = [...this.createdDirs].sort((a, b) => b.length - a.length);
    for (const dir of dirs) await fs.rmdir(path.join(this.sandbox.workspace.path, dir)).catch(() => undefined);
    await this.restorePatched();
    await fs.rm(path.join(this.sandbox.workspace.path, SCRATCH_DIR), { recursive: true, force: true });
    if ((await this.sandbox.diff()) !== this.patch.diff) {
      throw new CounterTestError("the workspace no longer matches the patch under review");
    }
  }

  private async restorePatched(): Promise<void> {
    await this.sandbox.resetToHead();
    if (this.patch.diff.trim()) await this.sandbox.applyPatchFile(this.patchFile);
  }

  /** A new file for the test: never a tracked file, never inside .git or the scratch dir. */
  private async targetFor(file: string): Promise<string> {
    const relative = this.files.normalize(file);
    const top = relative.split("/")[0]!;
    if (top === ".git" || top === SCRATCH_DIR) throw new CounterTestError(`counter-tests can't be written under ${top}/`);
    if (this.files.has(relative)) throw new CounterTestError(`${relative} is a tracked file; counter-tests go in new files`);
    const absolute = path.join(this.sandbox.workspace.path, relative);
    if (!this.written.has(relative)) {
      const exists = await fs.stat(absolute).then(() => true, () => false);
      if (exists) throw new CounterTestError(`${relative} already exists; pick a new path`);
    }
    await this.makeParentDirs(relative);
    const root = await fs.realpath(this.sandbox.workspace.path);
    const parent = await fs.realpath(path.dirname(absolute));
    if (parent !== root && !parent.startsWith(root + path.sep)) {
      throw new CounterTestError(`${relative} resolves outside the workspace`);
    }
    this.written.add(relative);
    return absolute;
  }

  private async makeParentDirs(relative: string): Promise<void> {
    const parts = relative.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const absolute = path.join(this.sandbox.workspace.path, dir);
      const exists = await fs.stat(absolute).then(() => true, () => false);
      if (!exists) {
        await fs.mkdir(absolute);
        this.createdDirs.add(dir);
      }
    }
  }
}
