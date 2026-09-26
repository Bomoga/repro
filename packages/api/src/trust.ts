import type { Diagnosis, Finding, Patch } from "@repro/contracts";

// The Trust Report: how much a human should trust a proposed Patch before merging it. Pure and
// deterministic (no model call) so both the dashboard's Trust Report view and the GitHub PR
// narrator compute the same verdict from the same Patch.
export interface TrustReport {
  patchId: string;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

export function buildTrustReport(patch: Patch, diagnosis: Diagnosis | undefined, findings: Finding[]): TrustReport {
  const reasons: string[] = [];
  let score = 0;

  if (patch.testsPassed) {
    score += 1;
    reasons.push("Existing tests pass against the patched tree.");
  } else {
    reasons.push("Existing tests do not pass against the patched tree.");
  }

  if (!patch.originalFindingReproduces) {
    score += 1;
    reasons.push("The original Finding no longer reproduces.");
  } else {
    reasons.push("The original Finding still reproduces after the patch.");
  }

  if (patch.challengerVerdict === "confirmed") {
    score += 1;
    reasons.push("The Challenger confirmed the fix against its counter-tests.");
  } else {
    reasons.push(`The Challenger's verdict is disputed${patch.challengerNotes ? `: ${patch.challengerNotes}` : "."}`);
  }

  if (patch.regressionFindings.length === 0) {
    score += 1;
    reasons.push("No new regressions were detected on the patched tree.");
  } else {
    reasons.push(`${patch.regressionFindings.length} new regression finding(s) on the patched tree.`);
  }

  if (diagnosis && findings.some((f) => f.severity === "critical" || f.severity === "high")) {
    reasons.push(`Addresses a ${findings.find((f) => f.severity === "critical") ? "critical" : "high"}-severity finding.`);
  }

  const confidence: TrustReport["confidence"] = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  return { patchId: patch.id, confidence, reasons };
}
