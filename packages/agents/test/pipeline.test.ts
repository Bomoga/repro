import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PatchSchema } from "../src/contracts.js";
import { repairAndVerify, type RepairAndVerifyDeps, type RepairProgress } from "../src/pipeline.js";
import { SQLI_DIAGNOSIS } from "./fixtures/diagnoses.js";
import { FIXTURE_FINDINGS, PLANTED_SECRET } from "./fixtures/findings.js";
import { ESCAPED_FIX, JOINED_FIX, SOUND_FIX, counterTest, verdict } from "./fixtures/scripts.js";
import { FixtureExecutor, demoTargetHandlers, fakeSemgrepAdapter } from "./helpers/executor.js";
import { scriptedGemini } from "./helpers/gemini.js";
import { materializeWorkspace, type FixtureWorkspace } from "./helpers/workspace.js";

describe("repairAndVerify", () => {
  let fixture: FixtureWorkspace;
  let executor: FixtureExecutor;
  let n: number;

  beforeEach(() => {
    fixture = materializeWorkspace();
    executor = new FixtureExecutor(demoTargetHandlers(PLANTED_SECRET));
    n = 0;
  });
  afterEach(() => fixture.cleanup());

  const deps = (gemini: RepairAndVerifyDeps["gemini"]): RepairAndVerifyDeps => ({
    gemini,
    executor,
    detectors: [fakeSemgrepAdapter],
    newId: () => `patch-${++n}`,
  });
  const input = () => ({ diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace });

  it("sends a disputed patch back, and the retry passes the same counter-test (demo beat 5)", async () => {
    const { gemini, byRole } = scriptedGemini({
      repair: [...JOINED_FIX, ...SOUND_FIX],
      challenger: [
        [{ name: "run_counter_test", args: counterTest("numeric-injection") }],
        [],
        verdict("disputed", "getNoteById still splices noteId into the SQL text via join()."),
        // Second attempt: the harness replays the counter-test first; nothing more to try.
        [],
        verdict("confirmed", "The replayed numeric-injection test passes against this patch."),
      ],
    });
    const result = await repairAndVerify(input(), deps(gemini));

    expect(result.attempts.map((a) => a.patch.status)).toEqual(["rejected", "verified"]);
    expect(result.patch).toBe(result.attempts[1]!.patch);
    expect(PatchSchema.parse(result.patch)).toEqual(result.patch);
    expect(result.attempts.map((a) => a.patch.id)).toEqual(["patch-1", "patch-2"]);

    const [first, second] = result.attempts;
    expect(first!.patch.originalFindingReproduces).toBe(false); // the detector was fooled...
    expect(first!.challenge!.counterTests[0]!.outcome).toBe("hole-open"); // ...the Challenger wasn't
    expect(second!.challenge!.counterTests[0]).toMatchObject({ outcome: "fix-holds", test: { path: "test/repro-counter-1.test.js" } });

    // The retry was told which counter-test broke the first patch.
    const retryPrompt = byRole("repair")[2]!.input as string;
    expect(retryPrompt).toContain("# The previous attempt was rejected");
    expect(retryPrompt).toContain("CHECKS:numeric-injection");
  });

  it("reports each attempt's stage and Patch as it goes, waiting for the caller", async () => {
    const { gemini } = scriptedGemini({
      repair: [...JOINED_FIX, ...SOUND_FIX],
      challenger: [
        [{ name: "run_counter_test", args: counterTest("numeric-injection") }],
        [],
        verdict("disputed", "getNoteById still splices noteId into the SQL text via join()."),
        [],
        verdict("confirmed", "The replayed numeric-injection test passes against this patch."),
      ],
    });
    const events: string[] = [];
    const onProgress = async (event: RepairProgress) => {
      await new Promise((resolve) => setTimeout(resolve, 1)); // a caller persisting as it goes
      events.push(event.type === "repairing" ? `repairing ${event.attempt}` : `${event.type} ${event.attempt} ${event.patch.id} ${event.patch.status}`);
    };
    await repairAndVerify(input(), { ...deps(gemini), onProgress });
    expect(events).toEqual([
      "repairing 1",
      "challenging 1 patch-1 proposed",
      "attempt-finished 1 patch-1 rejected",
      "repairing 2",
      "challenging 2 patch-2 proposed",
      "attempt-finished 2 patch-2 verified",
    ]);
  });

  it("doesn't spend a Challenger call on a patch the deterministic checks already reject", async () => {
    const { gemini, byRole } = scriptedGemini({
      repair: [...ESCAPED_FIX, ...SOUND_FIX],
      challenger: [[{ name: "run_counter_test", args: counterTest("numeric-injection") }], [], verdict("confirmed")],
    });
    const result = await repairAndVerify(input(), deps(gemini));

    expect(result.attempts[0]!.challenge).toBeUndefined();
    expect(result.attempts[0]!.patch).toMatchObject({ status: "rejected", originalFindingReproduces: true });
    expect(result.attempts[0]!.patch.challengerNotes).toMatch(/^Not challenged: the original finding still reproduces/);
    expect(byRole("challenger")).toHaveLength(3); // all of them for the second attempt
    expect(byRole("repair")[2]!.input).toContain("Reproduction re-run");
    expect(result.patch.status).toBe("verified");
  });

  it("gives up after two attempts and returns the last rejected Patch", async () => {
    const { gemini, byRole } = scriptedGemini({ repair: [[], [], [], []] });
    const result = await repairAndVerify(input(), deps(gemini));
    expect(result.attempts.map((a) => [a.repair.stopReason, a.patch.status])).toEqual([
      ["stalled", "rejected"],
      ["stalled", "rejected"],
    ]);
    expect(result.patch.status).toBe("rejected");
    expect(byRole("challenger")).toHaveLength(0);
  });
});
