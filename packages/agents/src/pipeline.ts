import type { Diagnosis, Finding, Patch, Workspace } from "./contracts.js";
import { excerpt } from "./sandbox.js";
import { repair, type RepairDeps, type RepairResult } from "./repair/repair.js";
import { challenge, latestRuns, type ChallengeDeps, type ChallengeResult } from "./verify/challenger.js";
import type { CounterTest } from "./verify/counter-tests.js";
import { applyGate, gateChecks } from "./verify/gate.js";

/** Section 5: two attempts per Diagnosis, the verify-to-diagnose retry edge included. */
export const MAX_ATTEMPTS_PER_DIAGNOSIS = 2;

export interface RepairAndVerifyInput {
  diagnosis: Diagnosis;
  /** Every Finding in the Run. Read-only. */
  findings: Finding[];
  workspace: Workspace;
  testCommand?: string;
}

/** Where repairAndVerify is, for a live view of the Run: the stage in flight, and each attempt's
 *  Patch as soon as it exists. Awaited, so the caller can persist one step before the next. */
export type RepairProgress =
  | { type: "repairing"; attempt: number }
  | { type: "challenging"; attempt: number; patch: Patch }
  | { type: "attempt-finished"; attempt: number; patch: Patch };

export type RepairAndVerifyDeps = RepairDeps &
  Omit<ChallengeDeps, "gemini" | "executor"> & {
    onProgress?: (event: RepairProgress) => void | Promise<void>;
  };

export interface AttemptRecord {
  repair: RepairResult;
  /** Absent when the Challenger never ran: the attempt failed before it. */
  challenge?: ChallengeResult;
  /** This attempt's final Patch: `verified` or `rejected`. */
  patch: Patch;
}

export interface RepairAndVerifyResult {
  /** The verified Patch, or the last rejected one. */
  patch: Patch;
  attempts: AttemptRecord[];
}

/**
 * Repair → deterministic checks → Challenger → gate, at most twice per Diagnosis. Each attempt
 * produces its own Patch; a rejected Patch stays rejected, and the retry starts from
 * headCommit with the reason it failed. The Challenger only runs on a Patch that already
 * passes the deterministic checks, and counter-tests that broke the first attempt are
 * replayed against the second.
 */
export async function repairAndVerify(input: RepairAndVerifyInput, deps: RepairAndVerifyDeps): Promise<RepairAndVerifyResult> {
  const attempts: AttemptRecord[] = [];
  let feedback: string | undefined;
  let replay: CounterTest[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_DIAGNOSIS; attempt++) {
    await deps.onProgress?.({ type: "repairing", attempt });
    const repaired = await repair({ ...input, feedback, attempt }, deps);
    const testCommand = input.testCommand ?? repaired.testCommand;

    if (repaired.patch.status === "rejected") {
      attempts.push({ repair: repaired, patch: repaired.patch });
      await deps.onProgress?.({ type: "attempt-finished", attempt, patch: repaired.patch });
      feedback = describeUnfinished(repaired);
      continue;
    }

    const failing = gateChecks(repaired.patch).filter((check) => check.name !== "challengerConfirmed" && !check.passed);
    if (failing.length > 0) {
      const patch = applyGate({ ...repaired.patch, challengerNotes: `Not challenged: ${failing.map((c) => c.detail).join("; ")}.` });
      attempts.push({ repair: repaired, patch });
      await deps.onProgress?.({ type: "attempt-finished", attempt, patch });
      feedback = describeFailedChecks(repaired, failing.map((c) => c.detail));
      continue;
    }

    await deps.onProgress?.({ type: "challenging", attempt, patch: repaired.patch });
    const challenged = await challenge(
      { patch: repaired.patch, diagnosis: input.diagnosis, findings: input.findings, workspace: input.workspace, testCommand, replay },
      deps,
    );
    attempts.push({ repair: repaired, challenge: challenged, patch: challenged.patch });
    await deps.onProgress?.({ type: "attempt-finished", attempt, patch: challenged.patch });
    if (challenged.patch.status === "verified") return { patch: challenged.patch, attempts };
    const broke = latestRuns(challenged.counterTests).filter((run) => run.outcome === "hole-open" || run.outcome === "regression");
    replay = broke.map((run) => run.test);
    feedback = describeDispute(challenged, broke.map((run) => run.test));
  }
  return { patch: attempts[attempts.length - 1]!.patch, attempts };
}

function describeUnfinished(repaired: RepairResult): string {
  const reason = {
    finished: "finished without changing any file",
    tool_limit: "ran out of tool calls before calling finish",
    stalled: "stopped calling tools before finishing",
  }[repaired.stopReason];
  const calls = repaired.toolCalls.map((call) => `- ${call.name}: ${call.summary}`).join("\n");
  return `The previous attempt ${reason}.${calls ? `\nIts tool calls:\n${calls}` : ""}`;
}

function describeFailedChecks(repaired: RepairResult, failures: string[]): string {
  const sections = [`The previous patch failed the harness's own checks: ${failures.join("; ")}.`];
  if (!repaired.patch.testsPassed && repaired.testOutput) sections.push(`Test run:\n${excerpt(repaired.testOutput, 3_000)}`);
  if (repaired.patch.originalFindingReproduces && repaired.patch.reproductionOutputAfter) {
    sections.push(`Reproduction re-run:\n${excerpt(repaired.patch.reproductionOutputAfter, 3_000)}`);
  }
  for (const finding of repaired.patch.regressionFindings) {
    sections.push(`New finding introduced: ${finding.ruleId} at ${finding.file}:${finding.lineStart}: ${finding.message}`);
  }
  sections.push(`The rejected diff:\n${excerpt(repaired.patch.diff, 4_000)}`);
  return sections.join("\n\n");
}

function describeDispute(challenged: ChallengeResult, broke: CounterTest[]): string {
  const sections = [`The Challenger disputed the previous patch:\n${challenged.patch.challengerNotes ?? ""}`];
  for (const test of broke) {
    sections.push(
      `This counter-test still failed on the patched tree. It will be run again against your new patch, which must pass it by fixing ` +
        `the behaviour it checks for every caller, not by recognising the test:\n` +
        `path: ${test.path}\ncommand: ${test.command}\n${test.code}`,
    );
  }
  sections.push(`The rejected diff:\n${excerpt(challenged.patch.diff, 4_000)}`);
  return sections.join("\n\n");
}
