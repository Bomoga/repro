import { describe, expect, it } from "vitest";
import type { GeminiClient, InteractResponse } from "@repro/agents";
import { narratePr } from "../src/narrator/pr-narrator.js";
import type { Diagnosis, Finding, Patch } from "@repro/contracts";

function fakeGemini(outputText: string): GeminiClient {
  return {
    async interact(): Promise<InteractResponse> {
      return {
        interactionId: "i1",
        model: "gemini-3.8-flash",
        status: "completed",
        outputText,
        functionCalls: [],
      };
    },
  };
}

const diagnosis: Diagnosis = {
  id: "d1",
  findingIds: ["f1"],
  rootCause: "secret committed to source",
  proposedStrategy: "move to env var",
  riskNotes: "low risk",
  model: "gemini-3.1-pro-preview",
  createdAt: new Date().toISOString(),
};

const patch: Patch = {
  id: "p1",
  diagnosisId: "d1",
  diff: "diff --git a/src/config.js b/src/config.js",
  filesChanged: ["src/config.js"],
  testsPassed: true,
  originalFindingReproduces: false,
  regressionFindings: [],
  challengerVerdict: "confirmed",
  status: "verified",
};

const findings: Finding[] = [];

describe("narratePr", () => {
  it("parses a well-formed narration", async () => {
    const result = await narratePr(
      { gemini: fakeGemini(JSON.stringify({ title: "Fix hardcoded secret", body: "Moved the key to env." })) },
      { diagnosis, patch, findings },
    );
    expect(result).toEqual({ title: "Fix hardcoded secret", body: "Moved the key to env." });
  });

  it("unwraps a fenced JSON response", async () => {
    const fenced = "```json\n" + JSON.stringify({ title: "T", body: "B" }) + "\n```";
    const result = await narratePr({ gemini: fakeGemini(fenced) }, { diagnosis, patch, findings });
    expect(result).toEqual({ title: "T", body: "B" });
  });

  it("throws on a response that doesn't match the schema", async () => {
    await expect(narratePr({ gemini: fakeGemini("not json") }, { diagnosis, patch, findings })).rejects.toThrow(
      /invalid PR narration/,
    );
  });
});
