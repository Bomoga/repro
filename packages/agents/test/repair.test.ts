import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PatchSchema, type DetectorAdapter, type Finding } from "../src/contracts.js";
import type { FunctionCall, GeminiClient, InputItem, InteractRequest } from "../src/gemini.js";
import { MAX_TOOL_CALLS, detectTestCommand, repair, type RepairDeps } from "../src/repair/repair.js";
import { WorkspaceFiles } from "../src/workspace-files.js";
import { KEY_DIAGNOSIS, SQLI_DIAGNOSIS, UNCONFIRMED_DIAGNOSIS } from "./fixtures/diagnoses.js";
import { FIXTURE_FINDINGS, PLANTED_SECRET } from "./fixtures/findings.js";
import { NOTE_NEW, NOTE_OLD, OWNER_ESCAPED, OWNER_NEW, OWNER_OLD } from "./fixtures/scripts.js";
import { FixtureExecutor, demoTargetHandlers } from "./helpers/executor.js";
import { materializeWorkspace, type FixtureWorkspace } from "./helpers/workspace.js";

type Turn = { name: string; args?: Record<string, unknown> }[];

/** Mocked wrapper that answers each turn with the next scripted batch of function calls. */
function scriptedRepairGemini(turns: Turn[] | ((turn: number) => Turn)) {
  const requests: InteractRequest[] = [];
  const gemini: GeminiClient = {
    async interact(request) {
      requests.push(request);
      const n = requests.length;
      const turn = typeof turns === "function" ? turns(n) : turns[n - 1];
      if (!turn) throw new Error(`no scripted turn ${n}`);
      const functionCalls: FunctionCall[] = turn.map((call, i) => ({ id: `call-${n}-${i}`, name: call.name, arguments: call.args ?? {} }));
      return { interactionId: `int-${n}`, model: "gemini-test", status: functionCalls.length ? "requires_action" : "completed", outputText: "", functionCalls };
    },
  };
  return { gemini, requests };
}

const fullFix: Turn[] = [
  [{ name: "read_file", args: { path: "src/db.js" } }],
  [
    { name: "replace_in_file", args: { path: "src/db.js", old_text: OWNER_OLD, new_text: OWNER_NEW } },
    { name: "replace_in_file", args: { path: "src/db.js", old_text: NOTE_OLD, new_text: NOTE_NEW } },
  ],
  [{ name: "run_tests" }, { name: "rerun_detector" }],
  [{ name: "finish", args: { summary: "Parameterized both queries." } }],
];

const noDetectors: DetectorAdapter[] = [];

describe("repair", () => {
  let fixture: FixtureWorkspace;
  let executor: FixtureExecutor;
  let ids: number;
  const deps = (gemini: GeminiClient, extra: Partial<RepairDeps> = {}): RepairDeps => ({
    gemini,
    executor,
    detectors: noDetectors,
    newId: () => `patch-${++ids}`,
    ...extra,
  });
  const onDisk = (file: string) => readFileSync(path.join(fixture.workspace.path, file), "utf8");

  beforeEach(() => {
    fixture = materializeWorkspace();
    executor = new FixtureExecutor(demoTargetHandlers(PLANTED_SECRET));
    ids = 0;
  });
  afterEach(() => fixture.cleanup());

  it("fixes the injection through tools, and the harness alone computes and judges the Patch", async () => {
    const { gemini, requests } = scriptedRepairGemini(fullFix);
    const run = await repair({ diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));

    expect(run.stopReason).toBe("finished");
    expect(run.summary).toBe("Parameterized both queries.");
    expect(run.toolCalls.map((c) => [c.name, c.ok])).toEqual([
      ["read_file", true],
      ["replace_in_file", true],
      ["replace_in_file", true],
      ["run_tests", true],
      ["rerun_detector", true],
      ["finish", true],
    ]);

    const patch = run.patch;
    expect(PatchSchema.parse(patch)).toEqual(patch);
    expect(patch).toMatchObject({
      id: "patch-1",
      diagnosisId: SQLI_DIAGNOSIS.id,
      filesChanged: ["src/db.js"],
      testsPassed: true,
      originalFindingReproduces: false,
      regressionFindings: [],
      challengerVerdict: "disputed",
      status: "proposed",
    });
    // The diff is git's output for the edits on disk, not anything the model wrote.
    expect(patch.diff).toMatch(/^diff --git a\/src\/db\.js b\/src\/db\.js/);
    expect(patch.diff).toContain(`-  const sql = "SELECT id, title, body FROM notes WHERE owner_id = '" + ownerId`);
    expect(patch.diff).toContain("+  const rows = db.query(sql, [noteId]);");
    expect(patch.reproductionOutputAfter).toContain("$ semgrep scan");
    expect(patch.reproductionOutputAfter).toContain("0 findings");

    // The file the findings point to comes up front, as read_file would return it.
    expect(requests[0]!.input).toContain("# The files the findings point to");
    expect(requests[0]!.input).toContain("  const sql = 'SELECT id, owner_id, title, body FROM notes WHERE id = ' + noteId;");

    // Each turn re-sends tools and system instruction and chains onto the previous interaction.
    expect(requests).toHaveLength(4);
    for (const [i, request] of requests.entries()) {
      expect(request.role).toBe("repair");
      expect(request.tools?.map((t) => t.name)).toEqual(["read_file", "replace_in_file", "run_tests", "rerun_detector", "finish"]);
      expect(request.systemInstruction.length).toBeGreaterThan(100);
      expect(request.previousInteractionId).toBe(i === 0 ? undefined : `int-${i}`);
    }
    const thirdTurnResults = requests[3]!.input as InputItem[];
    expect(thirdTurnResults[0]).toMatchObject({ type: "function_result", callId: "call-3-0", name: "run_tests" });
    expect(JSON.stringify(thirdTurnResults)).toContain("TESTS PASSED");
    expect(JSON.stringify(thirdTurnResults)).toContain("no longer reproduces");
  });

  it("fails closed on a symptom-only fix: the reproduction re-run still flags it", async () => {
    const { gemini } = scriptedRepairGemini([
      [{ name: "replace_in_file", args: { path: "src/db.js", old_text: OWNER_OLD, new_text: OWNER_ESCAPED } }],
      [{ name: "finish", args: { summary: "Escaped quotes." } }],
    ]);
    const run = await repair({ diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));
    expect(run.patch.status).toBe("proposed");
    expect(run.patch.testsPassed).toBe(true);
    expect(run.patch.originalFindingReproduces).toBe(true);
    expect(run.patch.reproductionOutputAfter).toContain("2 findings");
  });

  it("refuses a Diagnosis that cites an unconfirmed Finding, before touching anything", async () => {
    const { gemini, requests } = scriptedRepairGemini([]);
    await expect(
      repair({ diagnosis: UNCONFIRMED_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini)),
    ).rejects.toThrow(/isn't reproducible/);
    expect(requests).toHaveLength(0);
    expect(executor.requests).toHaveLength(0);
  });

  it(`stops at ${MAX_TOOL_CALLS} working tool calls, allowing only finish after that`, async () => {
    const { gemini, requests } = scriptedRepairGemini(() => [{ name: "read_file", args: { path: "src/db.js" } }]);
    const run = await repair({ diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));
    expect(run.stopReason).toBe("tool_limit");
    expect(run.toolCalls).toHaveLength(MAX_TOOL_CALLS);
    expect(requests).toHaveLength(MAX_TOOL_CALLS + 1);
    expect(JSON.stringify(requests[MAX_TOOL_CALLS]!.input)).toContain("The tool budget is spent");
    expect(run.patch.status).toBe("rejected");
  });

  it("doesn't run calls past the budget within a single turn", async () => {
    const { gemini, requests } = scriptedRepairGemini([
      [{ name: "read_file", args: { path: "src/db.js" } }, { name: "read_file", args: { path: "src/db.js" } }, { name: "read_file", args: { path: "src/db.js" } }],
      [{ name: "finish", args: { summary: "done" } }],
    ]);
    const run = await repair(
      { diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace },
      deps(gemini, { maxToolCalls: 2 }),
    );
    expect(run.toolCalls.filter((c) => c.name === "read_file")).toHaveLength(2);
    const results = requests[1]!.input as InputItem[];
    expect(results[2]).toMatchObject({ type: "function_result", isError: true, result: expect.stringContaining("budget is spent") });
    expect(run.stopReason).toBe("finished");
  });

  it("gives up on a model that stops calling tools, after one nudge", async () => {
    const { gemini, requests } = scriptedRepairGemini([[], []]);
    const run = await repair({ diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));
    expect(run.stopReason).toBe("stalled");
    expect(requests[1]!.input).toEqual([{ type: "text", text: "Use the tools to make and check the fix, then call finish." }]);
    expect(run.patch.status).toBe("rejected");
    expect(run.patch.diff).toBe("");
  });

  it("returns tool errors to the model instead of throwing", async () => {
    const { gemini, requests } = scriptedRepairGemini([
      [
        { name: "read_file", args: { path: "../../etc/passwd" } },
        { name: "replace_in_file", args: { path: "src/db.js", old_text: "does not exist", new_text: "x" } },
        { name: "delete_everything" },
      ],
      [{ name: "finish", args: { summary: "nothing" } }],
    ]);
    const run = await repair({ diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));
    const results = requests[1]!.input as InputItem[];
    expect(results.slice(0, 3).map((r) => r.type === "function_result" && r.isError)).toEqual([true, true, true]);
    expect(JSON.stringify(results)).toContain("escapes the workspace");
    expect(run.toolCalls.map((c) => c.ok)).toEqual([false, false, false, true]);
    expect(run.patch.status).toBe("rejected"); // finished, but with no change to show
  });

  it("starts every attempt from headCommit", async () => {
    writeFileSync(path.join(fixture.workspace.path, "src/db.js"), "// left over from an earlier attempt\n");
    const { gemini } = scriptedRepairGemini([[{ name: "finish", args: { summary: "noop" } }]]);
    const run = await repair({ diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));
    expect(executor.commands()[0]).toBe(`git -c core.quotepath=off reset --hard --quiet ${fixture.workspace.headCommit}`);
    expect(onDisk("src/db.js")).toContain("function findNotesByOwner");
    expect(run.patch.diff).toBe("");
  });

  it("removes a hardcoded key without the key ever reaching Gemini", async () => {
    const { gemini, requests } = scriptedRepairGemini([
      [{ name: "read_file", args: { path: "src/config.js" } }],
      [
        {
          name: "replace_in_file",
          args: { path: "src/config.js", old_text: "OPENAI_API_KEY: '[REDACTED-SECRET-1]',", new_text: "OPENAI_API_KEY: process.env.OPENAI_API_KEY," },
        },
      ],
      [{ name: "rerun_detector" }],
      [{ name: "finish", args: { summary: "Read the key from the environment." } }],
    ]);
    const run = await repair({ diagnosis: KEY_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace }, deps(gemini));

    expect(JSON.stringify(requests)).not.toContain(PLANTED_SECRET);
    expect(requests[0]!.input).toContain("  OPENAI_API_KEY: '[REDACTED-SECRET-1]',"); // the preloaded file
    expect(JSON.stringify(requests[1]!.input)).toContain("[REDACTED-SECRET-1]");
    expect(onDisk("src/config.js")).not.toContain(PLANTED_SECRET);
    expect(run.patch.diff).toContain("+  OPENAI_API_KEY: process.env.OPENAI_API_KEY,");
    expect(run.patch.originalFindingReproduces).toBe(false);
    expect(run.patch.reproductionOutputAfter ?? "").not.toContain(PLANTED_SECRET);
  });

  it("reports only findings the patch introduced, in files it changed, as regressions", async () => {
    const at = (file: string, ruleId: string, evidence: string): Finding => ({
      id: `post-${ruleId}`,
      detectorId: "semgrep",
      ruleId,
      severity: "medium",
      category: "correctness",
      file,
      lineStart: 1,
      lineEnd: 1,
      message: "m",
      evidence,
      reproducible: false,
      createdAt: "2026-09-26T11:00:00.000Z",
    });
    const introduced = at("src/db.js", "js.new-problem", "db.query(sql, [ownerId])");
    const detector: DetectorAdapter = {
      id: "semgrep",
      run: async () => [
        introduced,
        at("src/assistant.js", "js.elsewhere", "console.log(prompt)"), // file the patch didn't touch
        { ...at("src/db.js", FIXTURE_FINDINGS[0]!.ruleId, "still concatenating"), ruleId: FIXTURE_FINDINGS[0]!.ruleId }, // the cited rule: reproduction's call
      ],
    };
    const { gemini } = scriptedRepairGemini(fullFix);
    const run = await repair(
      { diagnosis: SQLI_DIAGNOSIS, findings: FIXTURE_FINDINGS, workspace: fixture.workspace },
      deps(gemini, { detectors: [detector] }),
    );
    expect(run.patch.regressionFindings).toEqual([introduced]);
  });

  it("detects a package.json test script as the test command", async () => {
    const files = await WorkspaceFiles.open(fixture.workspace, []);
    expect(await detectTestCommand(files)).toBe("npm test");
  });
});

describe("detectTestCommand", () => {
  const detect = async (fileIndex: string[], packageJson?: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), "repro-detect-"));
    try {
      if (packageJson !== undefined) writeFileSync(path.join(dir, "package.json"), packageJson);
      const workspace = { runId: "r", path: dir, fileIndex, languages: [], headCommit: "0".repeat(40) };
      return await detectTestCommand(await WorkspaceFiles.open(workspace, []));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("finds a pytest suite in a Python target", async () => {
    expect(await detect(["app/jobs.py", "tests/test_jobs.py"])).toBe("python -m pytest -q");
    expect(await detect(["app/jobs.py", "conftest.py"])).toBe("python -m pytest -q");
    expect(await detect(["app/jobs.py", "app/test_jobs.py"])).toBe("python -m pytest -q");
  });

  it("finds nothing when there's no suite, so testsPassed stays false and the gate can't verify", async () => {
    expect(await detect(["app/jobs.py", "assistant/memory.py"])).toBeUndefined();
    expect(await detect(["package.json", "index.js"], JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }))).toBeUndefined();
    expect(await detect(["package.json", "index.js"], "{ not json")).toBeUndefined();
  });
});
