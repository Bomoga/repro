import { describe, expect, it } from "vitest";
import type { Finding, Patch } from "../src/contracts.js";
import { applyGate, gateChecks } from "../src/verify/gate.js";
import { SQLI_OWNER } from "./fixtures/findings.js";

const passing: Patch = {
  id: "patch-1",
  diagnosisId: "diag-sqli",
  diff: "diff --git a/src/db.js b/src/db.js\n",
  filesChanged: ["src/db.js"],
  testsPassed: true,
  originalFindingReproduces: false,
  regressionFindings: [],
  challengerVerdict: "confirmed",
  challengerNotes: "Couldn't break it.",
  status: "proposed",
};

describe("applyGate", () => {
  it("verifies a Patch only when all four conditions hold", () => {
    expect(applyGate(passing).status).toBe("verified");
    expect(gateChecks(passing).every((check) => check.passed)).toBe(true);
  });

  const regression: Finding = { ...SQLI_OWNER, id: "post-1", reproducible: false };
  it.each([
    ["the tests fail", { testsPassed: false }],
    ["the original finding still reproduces", { originalFindingReproduces: true }],
    ["the patch introduced a finding", { regressionFindings: [regression] }],
    ["the Challenger disputes it", { challengerVerdict: "disputed" as const }],
  ])("rejects it when %s", (_, change) => {
    const gated = applyGate({ ...passing, ...change });
    expect(gated.status).toBe("rejected");
    expect(gateChecks({ ...passing, ...change }).filter((check) => !check.passed)).toHaveLength(1);
  });

  it("only gates proposed Patches, so verified and rejected are final", () => {
    for (const status of ["verified", "rejected", "merged"] as const) {
      expect(() => applyGate({ ...passing, status })).toThrow(/only a proposed Patch/);
    }
  });
});
