import { PatchSchema, type Patch } from "../contracts.js";

export interface GateCheck {
  name: "testsPassed" | "originalFindingFixed" | "noRegressions" | "challengerConfirmed";
  passed: boolean;
  detail: string;
}

/**
 * The four conditions section 5 puts on `verified`, evaluated from the Patch's recorded
 * results. Gemini supplies only `challengerVerdict`; the other three come from the Executor.
 */
export function gateChecks(patch: Patch): GateCheck[] {
  return [
    {
      name: "testsPassed",
      passed: patch.testsPassed,
      detail: patch.testsPassed ? "the project's tests pass" : "the project's tests fail or couldn't run",
    },
    {
      name: "originalFindingFixed",
      passed: !patch.originalFindingReproduces,
      detail: patch.originalFindingReproduces ? "the original finding still reproduces" : "the original finding no longer reproduces",
    },
    {
      name: "noRegressions",
      passed: patch.regressionFindings.length === 0,
      detail:
        patch.regressionFindings.length === 0
          ? "no new findings in changed files"
          : `new findings: ${patch.regressionFindings.map((f) => `${f.ruleId} at ${f.file}:${f.lineStart}`).join(", ")}`,
    },
    {
      name: "challengerConfirmed",
      passed: patch.challengerVerdict === "confirmed",
      detail: patch.challengerVerdict === "confirmed" ? "the Challenger failed to break the fix" : "the Challenger disputed the fix or hasn't confirmed it",
    },
  ];
}

/**
 * The Verification gate: the only code that sets `verified`. A Patch leaves `proposed` exactly
 * once, to `verified` when every check passes and to `rejected` otherwise.
 */
export function applyGate(patch: Patch): Patch {
  if (patch.status !== "proposed") {
    throw new Error(`only a proposed Patch can go through the gate; ${patch.id} is ${patch.status}`);
  }
  const verified = gateChecks(patch).every((check) => check.passed);
  return PatchSchema.parse({ ...patch, status: verified ? "verified" : "rejected" });
}
