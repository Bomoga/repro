import { ExecutorError } from "@repro/executor";
import { type ExecResult, type Executor, type Finding, type Workspace } from "@repro/contracts";
import { redactSecrets, truncate } from "./util.ts";

export const REPRODUCTION_OUTPUT_MAX = 4000;

export type ReproductionOutcome = "reproduced" | "not-reproduced" | "undecided" | "no-command";

// One entry per Finding, for the run's retained log (CLAUDE.md section 9).
export interface ReproductionAttempt {
  findingId: string;
  command?: string;
  outcome: ReproductionOutcome;
  exitCode?: number;
  timedOut?: boolean;
  durationMs?: number;
  error?: string;
}

export interface ReproduceOptions {
  timeoutMs?: number;
  concurrency?: number;
}

// Every reproductionCommand lane 2 writes (repro-semgrep-rule, repro-gitleaks-rule) follows one
// protocol: exit 1 with "REPRODUCED <tool> <rule> at <file>:<start>-<end>: ..." lines means the
// issue is present, exit 0 means it isn't, anything else is undecided. On top of the exit code,
// the output has to name this Finding's own file and start line: the command is deliberately
// line-agnostic (so it stays valid after a patch shifts lines), but at headCommit the match must
// be this exact one.
export function confirmsFinding(finding: Finding, result: ExecResult): boolean {
  if (result.timedOut || result.exitCode !== 1) return false;
  const marker = ` at ${finding.file}:${finding.lineStart}-`;
  return result.stdout.split("\n").some((line) => line.startsWith("REPRODUCED ") && line.includes(marker));
}

function outputExcerpt(result: ExecResult): string {
  const text = result.stderr.trim() ? `${result.stdout.trimEnd()}\n${result.stderr.trim()}` : result.stdout.trimEnd();
  return truncate(redactSecrets(text), REPRODUCTION_OUTPUT_MAX);
}

// The reproduction step: the only code path that flips Finding.reproducible to true, and the
// only one that writes Finding.reproductionOutput. Each Finding's reproductionCommand runs through
// the Executor; a Finding without one, or whose command doesn't demonstrate the issue, stays
// reproducible: false. Input Findings are not mutated.
export async function reproduce(
  findings: Finding[],
  workspace: Workspace,
  exec: Executor,
  options: ReproduceOptions = {},
): Promise<{ findings: Finding[]; attempts: ReproductionAttempt[] }> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const out: Finding[] = new Array(findings.length);
  const attempts: ReproductionAttempt[] = new Array(findings.length);

  async function one(i: number): Promise<void> {
    const { reproductionOutput: _discarded, ...base } = findings[i]!;
    const unconfirmed: Finding = { ...base, reproducible: false };
    const command = unconfirmed.reproductionCommand;
    if (!command) {
      out[i] = unconfirmed;
      attempts[i] = { findingId: unconfirmed.id, outcome: "no-command" };
      return;
    }
    let result: ExecResult;
    try {
      result = await exec.exec({ workspacePath: workspace.path, command, timeoutMs });
    } catch (err) {
      out[i] = unconfirmed;
      attempts[i] = {
        findingId: unconfirmed.id,
        command,
        outcome: "undecided",
        error: err instanceof ExecutorError ? err.message : String(err),
      };
      return;
    }
    const reproduced = confirmsFinding(unconfirmed, result);
    out[i] = reproduced ? { ...unconfirmed, reproducible: true, reproductionOutput: outputExcerpt(result) } : unconfirmed;
    attempts[i] = {
      findingId: unconfirmed.id,
      command,
      outcome: reproduced ? "reproduced" : !result.timedOut && result.exitCode === 0 ? "not-reproduced" : "undecided",
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
  }

  // Canary tracing (repro-canary) runs the target's code and reads what it wrote to the shared
  // workspace, so those runs go one at a time, after everything else: a concurrent run's files can't
  // be mistaken for, or cleaned up as, the canary's.
  const exclusive = (i: number) => findings[i]!.reproductionCommand?.startsWith("repro-canary ") === true;
  const shared = findings.map((_, i) => i).filter((i) => !exclusive(i));
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, shared.length) }, async () => {
    while (next < shared.length) await one(shared[next++]!);
  });
  await Promise.all(workers);
  for (let i = 0; i < findings.length; i++) if (exclusive(i)) await one(i);
  return { findings: out, attempts };
}
