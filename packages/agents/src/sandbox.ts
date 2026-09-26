/**
 * Everything Lane 3 runs against a workspace goes through the Executor (section 4): the
 * project's tests, reproduction re-runs, and the git commands that reset the tree and produce
 * `Patch.diff`. Nothing here shells out on the host.
 */
import type { ExecResult, Executor, Finding, Workspace } from "./contracts.js";

const SHA = /^[0-9a-f]{7,64}$/i;
const GIT_TIMEOUT_MS = 60_000;
export const TEST_TIMEOUT_MS = 300_000;
export const REPRODUCTION_TIMEOUT_MS = 120_000;

/**
 * How a reproduction command's result is read. The default treats any non-zero exit or a
 * timeout as "the issue still reproduces" (semgrep --error and gitleaks both exit non-zero
 * when they find something), which fails closed when the command itself breaks.
 */
export type ReproductionJudge = (finding: Finding, result: ExecResult) => boolean;
export const defaultReproductionJudge: ReproductionJudge = (_finding, result) => result.timedOut || result.exitCode !== 0;

export interface ReproductionCheck {
  command: string;
  findingIds: string[];
  reproduces: boolean;
  result: ExecResult;
}

export class Sandbox {
  constructor(
    readonly workspace: Workspace,
    private readonly executor: Executor,
  ) {
    if (!SHA.test(workspace.headCommit)) {
      throw new Error(`Workspace.headCommit must be a commit SHA, got: ${workspace.headCommit}`);
    }
  }

  exec(command: string, timeoutMs: number): Promise<ExecResult> {
    return this.executor.run({ workspacePath: this.workspace.path, command, timeoutMs });
  }

  private async git(args: string, what: string): Promise<string> {
    const result = await this.exec(`git -c core.quotepath=off ${args}`, GIT_TIMEOUT_MS);
    if (result.timedOut || result.exitCode !== 0) {
      throw new Error(`could not ${what}: exit ${result.exitCode}${result.timedOut ? " (timed out)" : ""} ${result.stderr.trim()}`);
    }
    return result.stdout;
  }

  /** Puts every tracked file back to `headCommit`; each Repair attempt starts from here. */
  async resetToHead(): Promise<void> {
    await this.git(`reset --hard --quiet ${this.workspace.headCommit}`, "reset the workspace");
  }

  /** The literal `git diff` against `headCommit`: this, never model text, becomes Patch.diff. */
  diff(): Promise<string> {
    return this.git(`diff --no-color --no-ext-diff --no-textconv ${this.workspace.headCommit}`, "diff the workspace");
  }

  async changedFiles(): Promise<string[]> {
    const out = await this.git(`diff --name-only --no-renames ${this.workspace.headCommit}`, "list changed files");
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  runTests(testCommand: string): Promise<ExecResult> {
    return this.exec(testCommand, TEST_TIMEOUT_MS);
  }

  /**
   * Re-runs each Finding's reproductionCommand (once per distinct command). A Finding with no
   * command can't be shown fixed, so it counts as still reproducing.
   */
  async checkReproduction(findings: Finding[], judge: ReproductionJudge = defaultReproductionJudge): Promise<ReproductionCheck[]> {
    const byCommand = new Map<string, Finding[]>();
    for (const finding of findings) {
      const command = finding.reproductionCommand?.trim() ?? "";
      byCommand.set(command, [...(byCommand.get(command) ?? []), finding]);
    }
    const checks: ReproductionCheck[] = [];
    for (const [command, group] of byCommand) {
      const result: ExecResult = command
        ? await this.exec(command, REPRODUCTION_TIMEOUT_MS)
        : { exitCode: -1, stdout: "", stderr: "no reproductionCommand on this Finding", timedOut: false, durationMs: 0 };
      checks.push({
        command,
        findingIds: group.map((f) => f.id),
        reproduces: !command || group.some((finding) => judge(finding, result)),
        result,
      });
    }
    return checks;
  }
}

/** A bounded excerpt of command output: the head and the tail survive. */
export function excerpt(text: string, max = 4_000): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.75);
  const tail = max - head;
  return `${text.slice(0, head)}\n…[${text.length - max} chars omitted]…\n${text.slice(-tail)}`;
}

export function formatExec(command: string, result: ExecResult, max = 4_000): string {
  const status = result.timedOut ? `timed out after ${result.durationMs}ms` : `exit ${result.exitCode}`;
  const output = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join("\n");
  return `$ ${command}\n[${status}]\n${excerpt(output, max)}`.trimEnd();
}
