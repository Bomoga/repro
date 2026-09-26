import { describe, it, expect } from "vitest";
import { FindingSchema, DiagnosisSchema, PatchSchema, RunSchema } from "./index";

describe("Contracts", () => {
  it("validates Finding schema", () => {
    const finding = {
      id: "find-1",
      detectorId: "semgrep",
      ruleId: "rule-1",
      severity: "high" as const,
      category: "vulnerability",
      file: "src/index.ts",
      lineStart: 1,
      lineEnd: 2,
      message: "Found issue",
      evidence: "const x = eval()",
      reproducible: true,
      createdAt: new Date().toISOString(),
    };
    expect(() => FindingSchema.parse(finding)).not.toThrow();
  });

  it("validates Diagnosis schema", () => {
    const diagnosis = {
      id: "diag-1",
      findingIds: ["find-1"],
      rootCause: "Unsafe eval usage",
      proposedStrategy: "Replace with safe alternative",
      riskNotes: "Security risk",
      model: "gemini-3.1-pro-preview",
      createdAt: new Date().toISOString(),
    };
    expect(() => DiagnosisSchema.parse(diagnosis)).not.toThrow();
  });

  it("validates Run schema", () => {
    const run = {
      id: "run-1",
      trigger: "manual" as const,
      target: { kind: "local" as const, ref: "." },
      stage: "detect" as const,
      status: "running" as const,
      startedAt: new Date().toISOString(),
      logRef: "log-1",
    };
    expect(() => RunSchema.parse(run)).not.toThrow();
  });
});
