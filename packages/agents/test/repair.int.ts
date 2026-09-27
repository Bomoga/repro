import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PatchSchema } from "../src/contracts.js";
import { MemoryInteractionLog, createGeminiClient } from "../src/gemini.js";
import { repair, type RepairResult } from "../src/repair/repair.js";
import { KEY_DIAGNOSIS, SQLI_DIAGNOSIS } from "./fixtures/diagnoses.js";
import { FIXTURE_FINDINGS, PLANTED_SECRET } from "./fixtures/findings.js";
import { FixtureExecutor, demoTargetHandlers, fakeSemgrepAdapter } from "./helpers/executor.js";
import { realGeminiConfigured } from "./helpers/gemini.js";
import { materializeWorkspace, type FixtureWorkspace } from "./helpers/workspace.js";

function report(label: string, run: RepairResult, log: MemoryInteractionLog) {
  console.log(`\n=== ${label}: ${run.stopReason}, patch ${run.patch.status}, ${run.interactionIds.length} turns`);
  for (const call of run.toolCalls) console.log(`  ${call.ok ? "ok  " : "FAIL"} ${call.name}: ${call.summary}`);
  console.log(`  summary: ${run.summary}`);
  console.log(`  testsPassed=${run.patch.testsPassed} originalFindingReproduces=${run.patch.originalFindingReproduces} regressions=${run.patch.regressionFindings.length}`);
  console.log(run.patch.diff);
  const ms = log.entries.reduce((sum, e) => sum + e.durationMs, 0);
  console.log(`  gemini: ${log.entries.length} calls, ${Math.round(ms / 1000)}s, errors: ${log.entries.filter((e) => e.error).map((e) => e.error!.message).join("; ") || "none"}`);
}

describe.skipIf(!realGeminiConfigured())("repair against the real Gemini API (mocked Executor)", () => {
  let fixture: FixtureWorkspace;
  let executor: FixtureExecutor;
  let log: MemoryInteractionLog;

  beforeEach(() => {
    fixture = materializeWorkspace("run-int-repair");
    executor = new FixtureExecutor(demoTargetHandlers(PLANTED_SECRET));
    log = new MemoryInteractionLog();
  });
  afterEach(() => fixture.cleanup());

  it("parameterizes both injected queries and proves it with the harness's own checks", async () => {
    const run = await repair(
      { diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace },
      { gemini: createGeminiClient({ log }), executor, detectors: [fakeSemgrepAdapter] },
    );
    report("sqli", run, log);

    expect(PatchSchema.parse(run.patch)).toEqual(run.patch);
    expect(run.stopReason).toBe("finished");
    expect(run.patch.status).toBe("proposed");
    expect(run.patch.filesChanged).toEqual(["src/db.js"]);
    expect(run.patch.testsPassed).toBe(true);
    expect(run.patch.originalFindingReproduces).toBe(false);
    expect(run.patch.regressionFindings).toEqual([]);
    expect(run.toolCalls.some((c) => c.name === "replace_in_file" && c.ok)).toBe(true);
  });

  it("moves the hardcoded key to the environment without the key ever reaching Gemini", async () => {
    const run = await repair(
      { diagnosis: KEY_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace },
      { gemini: createGeminiClient({ log }), executor, detectors: [] },
    );
    report("key", run, log);

    for (const entry of log.entries) {
      expect(JSON.stringify(entry)).not.toContain(PLANTED_SECRET);
    }
    expect(run.patch.status).toBe("proposed");
    expect(run.patch.filesChanged).toContain("src/config.js");
    expect(run.patch.originalFindingReproduces).toBe(false);
    expect(run.patch.testsPassed).toBe(true);
  });
});
