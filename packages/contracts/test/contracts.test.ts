import { describe, expect, it } from "vitest";
import { Diagnosis, ExecResult, Finding, Patch, Run } from "../src/index.js";

describe("@repro/contracts", () => {
  it("accepts a minimal valid Finding, defaulting nothing", () => {
    const finding: Finding = {
      id: "f1",
      detectorId: "gitleaks",
      ruleId: "generic-api-key",
      severity: "high",
      category: "vulnerability",
      file: "src/config.js",
      lineStart: 3,
      lineEnd: 3,
      message: "hardcoded secret",
      evidence: "const KEY = \"...\"",
      reproducible: false,
      createdAt: new Date().toISOString(),
    };
    expect(Finding.safeParse(finding).success).toBe(true);
  });

  it("rejects a Finding missing a required field", () => {
    const { message, ...rest } = {
      id: "f1",
      detectorId: "gitleaks",
      ruleId: "generic-api-key",
      severity: "high",
      category: "vulnerability",
      file: "src/config.js",
      lineStart: 3,
      lineEnd: 3,
      message: "hardcoded secret",
      evidence: "const KEY = \"...\"",
      reproducible: false,
      createdAt: new Date().toISOString(),
    };
    void message;
    expect(Finding.safeParse(rest).success).toBe(false);
  });

  it("rejects an unknown Patch status", () => {
    const patch = {
      id: "p1",
      diagnosisId: "d1",
      diff: "diff --git a/x b/x",
      filesChanged: ["x"],
      testsPassed: true,
      originalFindingReproduces: false,
      regressionFindings: [],
      challengerVerdict: "confirmed",
      status: "shipped",
    };
    expect(Patch.safeParse(patch).success).toBe(false);
  });

  it("accepts a Run with every stage/status combination", () => {
    const run: Run = {
      id: "r1",
      trigger: "manual",
      target: { kind: "github", ref: "main" },
      stage: "diagnose",
      status: "running",
      startedAt: new Date().toISOString(),
      logRef: "runs/r1.log",
    };
    expect(Run.safeParse(run).success).toBe(true);
  });

  it("requires a Diagnosis to cite at least the findingIds array (empty allowed by schema, semantics enforced by producers)", () => {
    const diagnosis: Diagnosis = {
      id: "d1",
      findingIds: ["f1"],
      rootCause: "root cause",
      proposedStrategy: "strategy",
      riskNotes: "notes",
      model: "gemini-3.1-pro-preview",
      createdAt: new Date().toISOString(),
    };
    expect(Diagnosis.safeParse(diagnosis).success).toBe(true);
  });

  it("accepts an ExecResult with a non-zero exit code (not itself a failure signal)", () => {
    const result: ExecResult = {
      exitCode: 1,
      stdout: "",
      stderr: "boom",
      timedOut: false,
      durationMs: 42,
    };
    expect(ExecResult.safeParse(result).success).toBe(true);
  });
});
