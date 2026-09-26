import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PatchSchema } from "../src/contracts.js";
import { diagnose, isRepairEligible } from "../src/diagnose/diagnose.js";
import { MemoryInteractionLog, createGeminiClient } from "../src/gemini.js";
import { repairAndVerify } from "../src/pipeline.js";
import { FIXTURE_FINDINGS, PLANTED_SECRET, PROMPT_LOGGED, SQLI_OWNER } from "./fixtures/findings.js";
import { FixtureExecutor, demoTargetHandlers, fakeSemgrepAdapter, simulatedInjectionCounterTest } from "./helpers/executor.js";
import { materializeWorkspace, type FixtureWorkspace } from "./helpers/workspace.js";

// Lane 3 end to end on the real Gemini API: Diagnose -> Repair -> Challenger -> gate. Commands
// are answered by the fixture Executor's oracles (the sandbox isn't wired in yet).

describe.skipIf(!process.env.GEMINI_API_KEY)("lane 3 end to end on the real Gemini API (simulated sandbox)", () => {
  let fixture: FixtureWorkspace;
  beforeEach(() => {
    fixture = materializeWorkspace("run-int-pipeline");
  });
  afterEach(() => fixture.cleanup());

  it("diagnoses the batch, then repairs and verifies the confirmed SQL injection", async () => {
    const log = new MemoryInteractionLog();
    const gemini = createGeminiClient({ log });
    const executor = new FixtureExecutor([simulatedInjectionCounterTest, ...demoTargetHandlers(PLANTED_SECRET)]);

    const diagnosed = await diagnose({ findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, { gemini });
    const sqli = diagnosed.diagnoses.find((d) => d.findingIds.includes(SQLI_OWNER.id))!;
    const unconfirmed = diagnosed.diagnoses.find((d) => d.findingIds.includes(PROMPT_LOGGED.id))!;
    expect(isRepairEligible(sqli, FIXTURE_FINDINGS)).toBe(true);
    expect(isRepairEligible(unconfirmed, FIXTURE_FINDINGS)).toBe(false);

    const result = await repairAndVerify(
      { diagnosis: sqli, findings: FIXTURE_FINDINGS, workspace: fixture.workspace },
      { gemini, executor, detectors: [fakeSemgrepAdapter] },
    );

    console.log(`\n=== diagnosis ${sqli.id} [${sqli.findingIds.join(", ")}] (${sqli.model})\n${sqli.rootCause}`);
    for (const [i, attempt] of result.attempts.entries()) {
      console.log(`--- attempt ${i + 1}: repair ${attempt.repair.stopReason} (${attempt.repair.toolCalls.length} tool calls), patch ${attempt.patch.status}`);
      for (const run of attempt.challenge?.counterTests ?? []) console.log(`    counter-test ${run.test.path}: ${run.outcome} — ${run.test.description}`);
      console.log(`    challenger: ${attempt.patch.challengerVerdict}\n${attempt.patch.challengerNotes}`);
    }
    console.log(result.patch.diff);
    const byModel = new Map<string, { calls: number; tokens: number; ms: number }>();
    for (const entry of log.entries) {
      const row = byModel.get(entry.model) ?? { calls: 0, tokens: 0, ms: 0 };
      const usage = entry.response?.usage;
      row.calls++;
      row.tokens += (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) + (usage?.thoughtTokens ?? 0);
      row.ms += entry.durationMs;
      byModel.set(entry.model, row);
    }
    for (const [model, row] of byModel) console.log(`gemini ${model}: ${row.calls} calls, ~${row.tokens} tokens, ${Math.round(row.ms / 1000)}s`);

    expect(PatchSchema.parse(result.patch)).toEqual(result.patch);
    expect(result.patch).toMatchObject({
      diagnosisId: sqli.id,
      status: "verified",
      testsPassed: true,
      originalFindingReproduces: false,
      regressionFindings: [],
      challengerVerdict: "confirmed",
    });
    for (const entry of log.entries) expect(JSON.stringify(entry.request)).not.toContain(PLANTED_SECRET);
  });
});
