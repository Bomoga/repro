import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiagnosisSchema, type Finding } from "../src/contracts.js";
import { diagnose, isRepairEligible } from "../src/diagnose/diagnose.js";
import { diagnosisOutputSchema } from "../src/diagnose/schema.js";
import { toGeminiSchema, type GeminiClient, type InteractRequest } from "../src/gemini.js";
import { FIXTURE_FINDINGS, HARDCODED_KEY, PLANTED_SECRET, PROMPT_LOGGED, SQLI_NOTE_ID, SQLI_OWNER } from "./fixtures/findings.js";
import { materializeWorkspace, type FixtureWorkspace } from "./helpers/workspace.js";

/** A mocked wrapper that replays canned output texts and records every request. */
function scriptedGemini(...outputs: unknown[]) {
  const requests: InteractRequest[] = [];
  const gemini: GeminiClient = {
    async interact(request) {
      requests.push(request);
      const next = outputs.shift();
      if (next === undefined) throw new Error("scriptedGemini ran out of responses");
      return {
        interactionId: `int-${requests.length}`,
        model: "gemini-test-model",
        status: "completed",
        outputText: typeof next === "string" ? next : JSON.stringify(next),
        functionCalls: [],
      };
    },
  };
  return { gemini, requests };
}

const item = (findingIds: string[], rootCause = "cause") => ({
  findingIds,
  rootCause,
  proposedStrategy: "strategy",
  riskNotes: "risk",
});

const goodOutput = {
  diagnoses: [
    item([SQLI_OWNER.id, SQLI_NOTE_ID.id], "SQL built by string concatenation"),
    item([HARDCODED_KEY.id], "API key committed to source"),
    item([PROMPT_LOGGED.id], "prompts logged unredacted"),
  ],
};

let ids = 0;
const deps = (gemini: GeminiClient) => ({
  gemini,
  now: () => new Date("2026-09-26T12:00:00.000Z"),
  newId: () => `diag-${++ids}`,
});

describe("diagnosisOutputSchema", () => {
  it("constrains findingIds to exactly the batch, split by confirmation", () => {
    const json = JSON.stringify(toGeminiSchema(diagnosisOutputSchema(FIXTURE_FINDINGS)));
    expect(json).toContain(JSON.stringify([SQLI_OWNER.id, SQLI_NOTE_ID.id, HARDCODED_KEY.id]));
    expect(json).toContain(JSON.stringify([PROMPT_LOGGED.id]));
    expect(json).toContain('"anyOf"');
  });

  it("uses a single variant when the whole batch is confirmed", () => {
    const json = JSON.stringify(toGeminiSchema(diagnosisOutputSchema([SQLI_OWNER, HARDCODED_KEY])));
    expect(json).not.toContain('"anyOf"');
  });
});

describe("diagnose", () => {
  let fixture: FixtureWorkspace;
  beforeEach(() => {
    fixture = materializeWorkspace();
  });
  afterEach(() => fixture.cleanup());

  it("produces contract-valid Diagnoses with harness-assigned id, model, and createdAt", async () => {
    const { gemini, requests } = scriptedGemini(goodOutput);
    const result = await diagnose({ findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));

    expect(result.attempts).toBe(1);
    expect(result.dropped).toEqual([]);
    expect(result.uncoveredFindingIds).toEqual([]);
    expect(result.diagnoses).toHaveLength(3);
    for (const diagnosis of result.diagnoses) {
      expect(DiagnosisSchema.parse(diagnosis)).toEqual(diagnosis);
      expect(diagnosis.model).toBe("gemini-test-model");
      expect(diagnosis.createdAt).toBe("2026-09-26T12:00:00.000Z");
    }
    expect(result.diagnoses[0]!.findingIds).toEqual([SQLI_OWNER.id, SQLI_NOTE_ID.id]);

    const request = requests[0]!;
    expect(request.role).toBe("diagnose");
    expect(request.responseSchema).toEqual(toGeminiSchema(diagnosisOutputSchema(FIXTURE_FINDINGS)));
  });

  it("builds a prompt with code context first, findings last, unconfirmed labeled, and no secrets", async () => {
    const { gemini, requests } = scriptedGemini(goodOutput);
    await diagnose({ findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));
    const input = requests[0]!.input as string;

    expect(input.indexOf("# Code context")).toBeLessThan(input.indexOf("# Findings in this batch"));
    expect(input).toContain("## src/db.js");
    expect(input).toContain(" 6 |   const sql = \"SELECT id, title, body FROM notes WHERE owner_id = '\" + ownerId");
    expect(input).toMatch(/"id": "fnd-prompt-logged",\s+"status": "UNCONFIRMED"/);
    expect(input).toMatch(/"id": "fnd-sqli-owner",\s+"status": "CONFIRMED"/);
    expect(input).not.toContain(PLANTED_SECRET);
    expect(input).toContain("[REDACTED-SECRET-1]");
  });

  it("redacts secrets from runFindings even when their Finding isn't in the batch", async () => {
    const { gemini, requests } = scriptedGemini({ diagnoses: [item([PROMPT_LOGGED.id])] });
    // A batch whose code context doesn't include config.js directly still can't leak it: the
    // redactor learns every secret in the run up front.
    const findingOnConfig: Finding = { ...PROMPT_LOGGED, file: "src/config.js", lineStart: 5, lineEnd: 5 };
    await diagnose(
      { findings: [findingOnConfig], workspace: fixture.workspace, runFindings: FIXTURE_FINDINGS },
      deps(gemini),
    );
    expect(requests[0]!.input).not.toContain(PLANTED_SECRET);
  });

  it("retries once with feedback when the post-check fails, then accepts a valid response", async () => {
    const { gemini, requests } = scriptedGemini(
      { diagnoses: [item(["fnd-invented"]), ...goodOutput.diagnoses.slice(1)] },
      goodOutput,
    );
    const result = await diagnose({ findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));
    expect(requests).toHaveLength(2);
    expect(requests[1]!.input).toContain("# Your previous response was rejected");
    expect(result.attempts).toBe(2);
    expect(result.diagnoses).toHaveLength(3);
    expect(result.dropped).toEqual([]);
  });

  it("drops and reports what still fails after the retry, keeping what passed", async () => {
    const stillBad = {
      diagnoses: [
        item([SQLI_OWNER.id, SQLI_NOTE_ID.id]),
        item([HARDCODED_KEY.id, "fnd-invented"]),
        item([SQLI_OWNER.id]), // already cited above
        item([HARDCODED_KEY.id, PROMPT_LOGGED.id]), // mixes confirmed and unconfirmed
        { ...item([PROMPT_LOGGED.id]), rootCause: "" },
      ],
    };
    const { gemini, requests } = scriptedGemini(stillBad, stillBad);
    const result = await diagnose({ findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));

    expect(requests).toHaveLength(2);
    expect(result.diagnoses.map((d) => d.findingIds)).toEqual([[SQLI_OWNER.id, SQLI_NOTE_ID.id]]);
    expect(result.dropped).toHaveLength(4);
    expect(result.dropped.map((d) => d.reason).join("\n")).toMatch(/already cited/);
    expect(result.uncoveredFindingIds).toEqual([HARDCODED_KEY.id, PROMPT_LOGGED.id]);
  });

  it("survives two unparseable responses by returning nothing and logging both", async () => {
    const { gemini } = scriptedGemini("not json", "{");
    const result = await diagnose({ findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));
    expect(result.diagnoses).toEqual([]);
    expect(result.attempts).toBe(2);
    expect(result.dropped).toHaveLength(1);
    expect(result.uncoveredFindingIds).toHaveLength(4);
  });

  it("keeps the better attempt when the retry is worse", async () => {
    const { gemini } = scriptedGemini({ diagnoses: goodOutput.diagnoses.slice(0, 2) }, "not json");
    const result = await diagnose({ findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));
    expect(result.diagnoses).toHaveLength(2);
    expect(result.uncoveredFindingIds).toEqual([PROMPT_LOGGED.id]);
  });

  it("never modifies the Findings it's given", async () => {
    const findings = structuredClone(FIXTURE_FINDINGS);
    const { gemini } = scriptedGemini(goodOutput);
    await diagnose({ findings, workspace: fixture.workspace }, deps(gemini));
    expect(findings).toEqual(FIXTURE_FINDINGS);
  });

  it("makes no model call for an empty batch and rejects duplicate IDs", async () => {
    const { gemini, requests } = scriptedGemini();
    expect((await diagnose({ findings: [], workspace: fixture.workspace }, deps(gemini))).diagnoses).toEqual([]);
    expect(requests).toHaveLength(0);
    await expect(diagnose({ findings: [SQLI_OWNER, SQLI_OWNER], workspace: fixture.workspace }, deps(gemini))).rejects.toThrow(/duplicate/);
  });
});

describe("isRepairEligible", () => {
  const base = { id: "d", rootCause: "r", proposedStrategy: "p", riskNotes: "n", model: "m", createdAt: "t" };

  it("admits a Diagnosis only when every cited Finding is reproducible", () => {
    expect(isRepairEligible({ ...base, findingIds: [SQLI_OWNER.id, SQLI_NOTE_ID.id] }, FIXTURE_FINDINGS)).toBe(true);
    expect(isRepairEligible({ ...base, findingIds: [PROMPT_LOGGED.id] }, FIXTURE_FINDINGS)).toBe(false);
    expect(isRepairEligible({ ...base, findingIds: [SQLI_OWNER.id, "fnd-missing"] }, FIXTURE_FINDINGS)).toBe(false);
    expect(isRepairEligible({ ...base, findingIds: [] }, FIXTURE_FINDINGS)).toBe(false);
  });
});
