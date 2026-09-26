import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InputItem } from "../src/gemini.js";
import { repair, type RepairResult } from "../src/repair/repair.js";
import { challenge } from "../src/verify/challenger.js";
import type { CounterTest } from "../src/verify/counter-tests.js";
import { SQLI_DIAGNOSIS } from "./fixtures/diagnoses.js";
import { FIXTURE_FINDINGS, PLANTED_SECRET } from "./fixtures/findings.js";
import { JOINED_FIX, SOUND_FIX, counterTest, verdict } from "./fixtures/scripts.js";
import { FixtureExecutor, demoTargetHandlers } from "./helpers/executor.js";
import { scriptedGemini, type ScriptedReply } from "./helpers/gemini.js";
import { git, materializeWorkspace, type FixtureWorkspace } from "./helpers/workspace.js";

describe("challenge", () => {
  let fixture: FixtureWorkspace;
  let executor: FixtureExecutor;

  beforeEach(() => {
    fixture = materializeWorkspace();
    executor = new FixtureExecutor(demoTargetHandlers(PLANTED_SECRET));
  });
  afterEach(() => fixture.cleanup());

  async function propose(turns: ScriptedReply[]): Promise<RepairResult> {
    const { gemini } = scriptedGemini({ repair: turns });
    const repaired = await repair(
      { diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace },
      { gemini, executor, detectors: [], newId: () => "patch-under-review" },
    );
    expect(repaired.patch.status).toBe("proposed");
    return repaired;
  }

  const run = (repaired: RepairResult, replies: ScriptedReply[], replay: CounterTest[] = [], limits = {}) => {
    const scripted = scriptedGemini({ challenger: replies });
    const promise = challenge(
      { patch: repaired.patch, diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace, testCommand: "npm test", replay },
      { gemini: scripted.gemini, executor, ...limits },
    );
    return { scripted, promise };
  };

  it("confirms a fix its counter-test fails to break, and leaves exactly the patch behind", async () => {
    const repaired = await propose(SOUND_FIX);
    const { scripted, promise } = run(repaired, [
      [{ name: "read_file", args: { path: "src/db.js" } }],
      [{ name: "run_counter_test", args: counterTest("numeric-injection") }],
      [],
      verdict("confirmed", "Numeric injection through getNoteById is bound now."),
    ]);
    const result = await promise;

    expect(result.counterTests.map((r) => [r.before.status, r.after.status, r.outcome])).toEqual([["fail", "pass", "fix-holds"]]);
    expect(result.modelVerdict).toBe("confirmed");
    expect(result.patch).toMatchObject({ status: "verified", challengerVerdict: "confirmed" });
    expect(result.patch.challengerNotes).toContain("the fix survived this attack");

    const attack = scripted.requests[0]!;
    expect(attack.tools?.map((t) => t.name)).toEqual(["read_file", "run_counter_test"]);
    expect(attack.responseSchema).toBeUndefined();
    expect(attack.input).toContain("# The patch under review");
    expect(attack.input).not.toContain("Parameterized both queries"); // the repair agent's own words stay out
    const verdictRequest = scripted.requests.at(-1)!;
    expect(verdictRequest.tools).toBeUndefined();
    expect(verdictRequest.responseSchema).toMatchObject({ properties: { verdict: { enum: ["confirmed", "disputed"] } } });

    expect(git(fixture.workspace.path, "diff", "--no-color", "--no-ext-diff", "--no-textconv", fixture.workspace.headCommit)).toBe(result.patch.diff);
    expect(existsSync(path.join(fixture.workspace.path, "test/repro-counter-1.test.js"))).toBe(false);
    expect(existsSync(path.join(fixture.workspace.path, ".repro"))).toBe(false);
  });

  it("catches a fix that fools the detector but still splices the id into SQL", async () => {
    const repaired = await propose(JOINED_FIX);
    expect(repaired.patch.originalFindingReproduces).toBe(false); // the detector is satisfied
    const { promise } = run(repaired, [
      [{ name: "run_counter_test", args: counterTest("numeric-injection") }],
      [],
      verdict("disputed", "getNoteById still builds SQL from noteId via join()."),
    ]);
    const result = await promise;
    expect(result.counterTests[0]!.outcome).toBe("hole-open");
    expect(result.patch).toMatchObject({ status: "rejected", challengerVerdict: "disputed" });
  });

  it("overrides a confirmation that its own counter-tests contradict", async () => {
    const repaired = await propose(JOINED_FIX);
    const { promise } = run(repaired, [[{ name: "run_counter_test", args: counterTest("numeric-injection") }], [], verdict("confirmed")]);
    const result = await promise;
    expect(result.modelVerdict).toBe("confirmed");
    expect(result.patch.challengerVerdict).toBe("disputed");
    expect(result.patch.status).toBe("rejected");
    expect(result.patch.challengerNotes).toContain("Harness override");
  });

  it("won't confirm on opinion alone: some attack has to fail before and pass after", async () => {
    const repaired = await propose(SOUND_FIX);
    const { promise } = run(repaired, [[], verdict("confirmed", "Looks right to me.")]);
    const result = await promise;
    expect(result.patch.challengerVerdict).toBe("disputed");
    expect(result.patch.challengerNotes).toMatch(/without a counter-test/);
  });

  it("counts only the latest run of each path, so a broken test can be fixed and re-run", async () => {
    const repaired = await propose(SOUND_FIX);
    const { promise } = run(repaired, [
      [{ name: "run_counter_test", args: counterTest("always-fails") }],
      [{ name: "run_counter_test", args: counterTest("numeric-injection") }],
      [],
      verdict("confirmed"),
    ]);
    const result = await promise;
    expect(result.counterTests.map((r) => r.outcome)).toEqual(["hole-open", "fix-holds"]);
    expect(result.patch.status).toBe("verified");
  });

  it("treats a test that passed before and fails after as a regression", async () => {
    const repaired = await propose(SOUND_FIX);
    const { promise } = run(repaired, [
      [
        { name: "run_counter_test", args: counterTest("numeric-injection") },
        { name: "run_counter_test", args: counterTest("old-sql-text", "test/repro-counter-2.test.js") },
      ],
      [],
      verdict("confirmed"),
    ]);
    const result = await promise;
    expect(result.counterTests.map((r) => r.outcome)).toEqual(["fix-holds", "regression"]);
    expect(result.patch.challengerVerdict).toBe("disputed");
  });

  it("keeps counter-tests out of tracked files, .git, and anywhere outside the workspace", async () => {
    const repaired = await propose(SOUND_FIX);
    const at = (file: string) => ({ name: "run_counter_test", args: { ...counterTest("numeric-injection"), path: file } });
    const { scripted, promise } = run(repaired, [[at("src/db.js"), at("../escape.test.js"), at(".git/hooks/pre-commit")], [], verdict("disputed")]);
    const result = await promise;
    const results = scripted.requests[1]!.input as InputItem[];
    expect(results.slice(0, 3).map((r) => r.type === "function_result" && r.isError)).toEqual([true, true, true]);
    expect(result.counterTests).toEqual([]);
    expect(existsSync(path.join(fixture.workspace.path, "..", "escape.test.js"))).toBe(false);
  });

  it("never runs a model-chosen command on the host, even one that looks like git", async () => {
    const repaired = await propose(SOUND_FIX);
    const hostile = { ...counterTest("numeric-injection"), command: "git config core.fsmonitor calc.exe" };
    const { promise } = run(repaired, [[{ name: "run_counter_test", args: hostile }], [], verdict("disputed")]);
    const result = await promise;
    expect(result.counterTests[0]!.outcome).toBe("inconclusive");
    expect(result.counterTests[0]!.after.result.exitCode).toBe(127);
    expect(readFileSync(path.join(fixture.workspace.path, ".git", "config"), "utf8")).not.toContain("fsmonitor");
  });

  it("treats two unparseable verdicts as a dispute", async () => {
    const repaired = await propose(SOUND_FIX);
    const { promise } = run(repaired, [[{ name: "run_counter_test", args: counterTest("numeric-injection") }], [], { text: "yes" }, { text: "{}" }]);
    const result = await promise;
    expect(result.modelVerdict).toBeUndefined();
    expect(result.patch.challengerVerdict).toBe("disputed");
    expect(result.patch.challengerNotes).toMatch(/no valid verdict/);
  });

  it("enforces the counter-test budget", async () => {
    const repaired = await propose(SOUND_FIX);
    const { scripted, promise } = run(
      repaired,
      [
        [
          { name: "run_counter_test", args: counterTest("numeric-injection") },
          { name: "run_counter_test", args: counterTest("owner-injection", "test/repro-counter-2.test.js") },
        ],
        [],
        verdict("confirmed"),
      ],
      [],
      { maxCounterTests: 1 },
    );
    const result = await promise;
    expect(result.counterTests).toHaveLength(1);
    expect(JSON.stringify(scripted.requests[1]!.input)).toContain("budget of 1 counter-tests is spent");
  });

  it("replays counter-tests from the previous attempt before the conversation starts", async () => {
    const repaired = await propose(SOUND_FIX);
    const { scripted, promise } = run(repaired, [[], verdict("confirmed")], [counterTest("numeric-injection")]);
    const result = await promise;
    expect(result.counterTests[0]!.outcome).toBe("fix-holds");
    expect(scripted.requests[0]!.input).toContain("replayed against this patch");
    expect(result.patch.status).toBe("verified");
  });

  it("only challenges a proposed Patch", async () => {
    const repaired = await propose(SOUND_FIX);
    const { promise } = run({ ...repaired, patch: { ...repaired.patch, status: "rejected" } }, []);
    await expect(promise).rejects.toThrow(/only a proposed Patch/);
  });
});
