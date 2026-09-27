import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryInteractionLog, createGeminiClient } from "../src/gemini.js";
import { repair, type RepairResult } from "../src/repair/repair.js";
import { challenge, type ChallengeResult } from "../src/verify/challenger.js";
import { SQLI_DIAGNOSIS } from "./fixtures/diagnoses.js";
import { FIXTURE_FINDINGS, PLANTED_SECRET } from "./fixtures/findings.js";
import { JOINED_FIX, SOUND_FIX } from "./fixtures/scripts.js";
import { FixtureExecutor, demoTargetHandlers, simulatedInjectionCounterTest } from "./helpers/executor.js";
import { realGeminiConfigured, scriptedGemini, type ScriptedReply } from "./helpers/gemini.js";
import { materializeWorkspace, type FixtureWorkspace } from "./helpers/workspace.js";

// The Challenger on the real Gemini API. Its counter-tests can only really be judged in the
// sandbox, so here they're answered by simulatedInjectionCounterTest: this checks the real
// conversation (tool turns, then a chained schema-only verdict) and the harness's verdict rule,
// not the quality of the tests Gemini writes.

function report(label: string, result: ChallengeResult, log: MemoryInteractionLog) {
  console.log(`\n=== ${label}: Gemini said ${result.modelVerdict ?? "(nothing valid)"}, patch ${result.patch.status}`);
  for (const run of result.counterTests) {
    console.log(`  ${run.test.path} [${run.test.command}] ${run.before.status} -> ${run.after.status}: ${run.outcome}\n    ${run.test.description}`);
  }
  console.log(`  notes:\n${result.patch.challengerNotes}`);
  const seconds = Math.round(log.entries.reduce((sum, e) => sum + e.durationMs, 0) / 1000);
  const tokens = log.entries.reduce((sum, e) => sum + (e.response?.usage?.inputTokens ?? 0) + (e.response?.usage?.outputTokens ?? 0) + (e.response?.usage?.thoughtTokens ?? 0), 0);
  console.log(`  gemini: ${log.entries.length} calls on ${log.entries[0]?.model}, ${seconds}s, ~${tokens} tokens`);
}

describe.skipIf(!realGeminiConfigured())("challenge against the real Gemini API (simulated counter-test runs)", () => {
  let fixture: FixtureWorkspace;
  let executor: FixtureExecutor;
  let log: MemoryInteractionLog;

  beforeEach(() => {
    fixture = materializeWorkspace("run-int-challenge");
    executor = new FixtureExecutor([simulatedInjectionCounterTest, ...demoTargetHandlers(PLANTED_SECRET)]);
    log = new MemoryInteractionLog();
  });
  afterEach(() => fixture.cleanup());

  /** A proposed Patch from a scripted repair: no model call needed to set the scene. */
  async function propose(turns: ScriptedReply[]): Promise<RepairResult> {
    const { gemini } = scriptedGemini({ repair: turns });
    const repaired = await repair(
      { diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace },
      { gemini, executor, detectors: [] },
    );
    expect(repaired.patch).toMatchObject({ status: "proposed", testsPassed: true, originalFindingReproduces: false });
    return repaired;
  }

  const challengeWithGemini = (repaired: RepairResult) =>
    challenge(
      { patch: repaired.patch, diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace, testCommand: repaired.testCommand },
      { gemini: createGeminiClient({ log }), executor },
    );

  it("attacks a fix that fooled the detector with a counter-test, and the gate rejects it", async () => {
    const result = await challengeWithGemini(await propose(JOINED_FIX));
    report("joined fix", result, log);

    expect(result.counterTests.length).toBeGreaterThan(0);
    expect(result.counterTests.some((run) => run.outcome === "hole-open")).toBe(true);
    expect(result.patch).toMatchObject({ status: "rejected", challengerVerdict: "disputed" });
    for (const entry of log.entries) expect(JSON.stringify(entry.request)).not.toContain(PLANTED_SECRET);
  });

  it("confirms a sound fix once a counter-test fails before it and passes after it", async () => {
    const result = await challengeWithGemini(await propose(SOUND_FIX));
    report("sound fix", result, log);

    expect(result.counterTests.some((run) => run.outcome === "fix-holds")).toBe(true);
    expect(result.modelVerdict).toBe("confirmed");
    expect(result.patch).toMatchObject({ status: "verified", challengerVerdict: "confirmed" });
    const verdictCall = log.entries.at(-1)!;
    expect(verdictCall.request.tools).toBeUndefined();
    expect(verdictCall.request.responseSchema).toBeDefined();
  });
});
