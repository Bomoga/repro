import { describe, expect, it } from "vitest";
import type { GeminiClient } from "@repro/gemini";
import type { Diagnosis, Finding, Patch } from "@repro/contracts";
import { narratePrBody, templatedPrBody } from "../src/narrator.ts";
import { buildTrustReport } from "@repro/api";

const finding: Finding = {
  id: "fnd_1",
  detectorId: "semgrep",
  ruleId: "rule",
  severity: "high",
  category: "vulnerability",
  file: "a.js",
  lineStart: 1,
  lineEnd: 1,
  message: "msg",
  evidence: "ev",
  reproducible: true,
  createdAt: new Date().toISOString(),
};

const diagnosis: Diagnosis = {
  id: "diag_1",
  findingIds: [finding.id],
  rootCause: "root cause",
  proposedStrategy: "strategy",
  riskNotes: "notes",
  model: "gemini-3.1-pro-preview",
  createdAt: new Date().toISOString(),
};

const patch: Patch = {
  id: "patch_1",
  diagnosisId: diagnosis.id,
  diff: "diff",
  filesChanged: ["a.js"],
  testsPassed: true,
  originalFindingReproduces: false,
  regressionFindings: [],
  challengerVerdict: "confirmed",
  status: "verified",
};

const trustReport = buildTrustReport(patch, diagnosis, [finding]);

describe("narratePrBody", () => {
  it("uses the narrator role's output text when Gemini succeeds", async () => {
    const gemini: GeminiClient = {
      interact: async (req) => {
        expect(req.role).toBe("narrator");
        return { interactionId: "i1", model: "gemini-3.8-flash", status: "completed", outputText: "Gemini wrote this.", functionCalls: [] };
      },
    };
    const body = await narratePrBody(gemini, { patch, diagnosis, findings: [finding], trustReport });
    expect(body).toBe("Gemini wrote this.");
  });

  it("falls back to the template when Gemini throws (e.g. quota exhausted)", async () => {
    const gemini: GeminiClient = {
      interact: async () => {
        throw new Error("429: per day quota exhausted");
      },
    };
    const body = await narratePrBody(gemini, { patch, diagnosis, findings: [finding], trustReport });
    expect(body).toBe(templatedPrBody({ patch, diagnosis, findings: [finding], trustReport }));
    expect(body).toContain("root cause");
    expect(body).toContain(trustReport.confidence);
  });

  it("falls back to the template when Gemini returns empty text", async () => {
    const gemini: GeminiClient = {
      interact: async () => ({ interactionId: "i1", model: "gemini-3.8-flash", status: "completed", outputText: "  ", functionCalls: [] }),
    };
    const body = await narratePrBody(gemini, { patch, diagnosis, findings: [finding], trustReport });
    expect(body).toContain("root cause");
  });
});
