import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DiagnosisSchema } from "../src/contracts.js";
import { diagnose, isRepairEligible, type DiagnoseResult } from "../src/diagnose/diagnose.js";
import { MemoryInteractionLog, createGeminiClient, modelFor } from "../src/gemini.js";
import { FIXTURE_FINDINGS, HARDCODED_KEY, PLANTED_SECRET, PROMPT_LOGGED, SQLI_NOTE_ID, SQLI_OWNER } from "./fixtures/findings.js";
import { realGeminiConfigured } from "./helpers/gemini.js";
import { materializeWorkspace, type FixtureWorkspace } from "./helpers/workspace.js";

describe.skipIf(!realGeminiConfigured())("diagnose against the real Gemini API", () => {
  let fixture: FixtureWorkspace;
  let result: DiagnoseResult;
  const log = new MemoryInteractionLog();

  beforeAll(async () => {
    fixture = materializeWorkspace("run-int-diagnose");
    result = await diagnose(
      { findings: FIXTURE_FINDINGS, workspace: fixture.workspace },
      { gemini: createGeminiClient({ log }) },
    );
    for (const d of result.diagnoses) {
      console.log(`\n[${d.findingIds.join(", ")}] (${d.model})\n  rootCause: ${d.rootCause}\n  strategy: ${d.proposedStrategy}\n  risk: ${d.riskNotes}`);
    }
    console.log(`attempts=${result.attempts} dropped=${result.dropped.length} uncovered=${result.uncoveredFindingIds.join(",") || "none"}`);
    for (const entry of log.entries) {
      console.log(`log: ${entry.label} attempt=${entry.attempt} ${entry.durationMs}ms usage=${JSON.stringify(entry.response?.usage)} error=${entry.error?.message ?? "none"}`);
    }
  });
  afterAll(() => fixture?.cleanup());

  it("returns contract-valid Diagnoses that cite only this batch's Findings, each exactly once", () => {
    expect(result.diagnoses.length).toBeGreaterThan(0);
    const batchIds = new Set(FIXTURE_FINDINGS.map((f) => f.id));
    const cited: string[] = [];
    for (const diagnosis of result.diagnoses) {
      expect(DiagnosisSchema.parse(diagnosis)).toEqual(diagnosis);
      expect(diagnosis.findingIds.length).toBeGreaterThan(0);
      for (const id of diagnosis.findingIds) expect(batchIds.has(id)).toBe(true);
      cited.push(...diagnosis.findingIds);
      expect(diagnosis.model).toBe(modelFor("diagnose"));
    }
    expect(new Set(cited).size).toBe(cited.length);
    expect(result.uncoveredFindingIds).toEqual([]);
  });

  it("never mixes confirmed and unconfirmed Findings, so only confirmed ones reach Repair", () => {
    for (const diagnosis of result.diagnoses) {
      const kinds = new Set(diagnosis.findingIds.map((id) => FIXTURE_FINDINGS.find((f) => f.id === id)!.reproducible));
      expect(kinds.size).toBe(1);
    }
    const unconfirmed = result.diagnoses.find((d) => d.findingIds.includes(PROMPT_LOGGED.id))!;
    expect(isRepairEligible(unconfirmed, FIXTURE_FINDINGS)).toBe(false);
  });

  it("groups the two SQL injections under one root cause", () => {
    const sqli = result.diagnoses.find((d) => d.findingIds.includes(SQLI_OWNER.id))!;
    expect(sqli.findingIds).toContain(SQLI_NOTE_ID.id);
    expect(sqli.findingIds).not.toContain(HARDCODED_KEY.id);
  });

  it("never sent the planted secret to Gemini", () => {
    expect(log.entries.length).toBeGreaterThan(0);
    for (const entry of log.entries) {
      expect(JSON.stringify(entry.request)).not.toContain(PLANTED_SECRET);
    }
  });
});
