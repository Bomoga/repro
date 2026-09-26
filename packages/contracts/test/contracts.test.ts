import { describe, expect, it } from "vitest";
import * as z from "zod";
import { ExecRequest, Finding, Patch, Workspace } from "../src/index.ts";

const finding = {
  id: "fnd_1",
  detectorId: "semgrep",
  ruleId: "javascript.express.security.audit.xss.direct-response-write",
  severity: "high",
  category: "vulnerability",
  file: "server/index.js",
  lineStart: 12,
  lineEnd: 12,
  message: "User input written directly to the response",
  evidence: "res.send(req.query.name);",
  reproducible: false,
  reproductionCommand: "repro-semgrep-rule '/opt/repro/rules/registry' 'x' 'server/index.js'",
  createdAt: new Date().toISOString(),
};

describe("contracts", () => {
  it("accepts a section 4 Finding, including an open-ended category", () => {
    expect(Finding.parse(finding)).toEqual(finding);
    expect(Finding.parse({ ...finding, category: "privacy" }).category).toBe("privacy");
  });

  it("rejects a severity outside the enum", () => {
    expect(() => Finding.parse({ ...finding, severity: "urgent" })).toThrow();
  });

  it("carries the adopted pending proof fields as optional", () => {
    expect(Finding.parse({ ...finding, reproducible: true, reproductionOutput: "REPRODUCED" }).reproductionOutput).toBe(
      "REPRODUCED",
    );
    const patch = {
      id: "p1",
      diagnosisId: "d1",
      diff: "",
      filesChanged: [],
      testsPassed: true,
      originalFindingReproduces: false,
      regressionFindings: [finding],
      challengerVerdict: "confirmed",
      status: "proposed",
    };
    expect(Patch.parse(patch).reproductionOutputAfter).toBeUndefined();
  });

  it("round-trips Workspace and ExecRequest", () => {
    const ws = { runId: "r1", path: "/tmp/ws", fileIndex: ["a.py"], languages: ["python"], headCommit: "abc" };
    expect(Workspace.parse(ws)).toEqual(ws);
    expect(() => ExecRequest.parse({ workspacePath: "/tmp/ws", command: "true", timeoutMs: 0 })).toThrow();
  });

  it("converts to JSON Schema for Gemini structured output", () => {
    const schema = z.toJSONSchema(Finding) as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toContain("reproductionOutput");
  });
});
