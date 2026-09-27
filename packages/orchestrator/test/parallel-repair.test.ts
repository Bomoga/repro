import { describe, expect, it, vi } from "vitest";
import { GeminiError, type RepairAndVerifyDeps, type RepairAndVerifyResult } from "@repro/agents";
import type { Diagnosis, Workspace } from "@repro/contracts";
import { processRun } from "../src/pipeline.ts";
import type { PullRequestInput } from "../src/pull-request.ts";
import type { WorkspaceCopies } from "../src/workspace-copy.ts";
import { aDiagnosis, aPatch, disputedThenVerified, harness, sdkBackedGemini, spendingRepair } from "./helpers.ts";

/** Diagnoses that all cite the reproduced finding, repaired `concurrency` at a time in fake workspace copies. */
function parallel(concurrency: number, ...ids: string[]) {
  const h = harness();
  h.deps.stages.diagnose = vi.fn(async (_input, { gemini }) => {
    await gemini.interact({ role: "diagnose", systemInstruction: "diagnose", input: "findings" });
    return { diagnoses: ids.map((id) => aDiagnosis(id, ["fnd_sqli"])), dropped: [], uncoveredFindingIds: [], attempts: 1 };
  });
  h.deps.gemini = sdkBackedGemini();
  const open = vi.fn(async (input: PullRequestInput) => `https://github.com/octo/example/pull/${input.diagnosis.id}`);
  h.deps.pullRequests = { open };
  const made: Workspace[] = [];
  const removed: string[] = [];
  const copies: WorkspaceCopies = {
    copy: async (workspace, name) => {
      const copy = { ...workspace, path: `${workspace.path}-copies/${name}/repo` };
      made.push(copy);
      return copy;
    },
    remove: (copy) => void removed.push(copy.path),
  };
  h.deps.repairConcurrency = concurrency;
  h.deps.workspaceCopies = copies;
  return { ...h, open, made, removed };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe("processRun repairing several diagnoses at once", () => {
  it("keeps at most the limit in flight, each in its own copy of the workspace, removed when it's done", async () => {
    const h = parallel(2, "diag_1", "diag_2", "diag_3", "diag_4", "diag_5");
    let inFlight = 0;
    let most = 0;
    const repairedIn: string[] = [];
    // Later diagnoses finish first, so the order repairs end in isn't the diagnoses' order.
    const takes: Record<string, number> = { diag_1: 40, diag_2: 5, diag_3: 25, diag_4: 5, diag_5: 10 };
    h.deps.stages.repairAndVerify = vi.fn(async (input, repairDeps) => {
      most = Math.max(most, ++inFlight);
      repairedIn.push(input.workspace.path);
      await sleep(takes[input.diagnosis.id]!);
      const result = await disputedThenVerified(input, repairDeps);
      inFlight--;
      return result;
    });
    const run = await h.queue();
    expect(await processRun(run, h.deps)).toMatchObject({ stage: "done", status: "completed" });

    expect(most).toBe(2);
    expect(new Set(repairedIn).size).toBe(5);
    expect(repairedIn).not.toContain("/workspaces/run_x/repo"); // no repair touches the Run's own workspace
    expect(h.made.map((copy) => copy.path).sort()).toEqual([...repairedIn].sort());
    expect(h.made.every((copy) => copy.runId === run.id && copy.headCommit === h.made[0]!.headCommit)).toBe(true);
    expect([...h.removed].sort()).toEqual([...repairedIn].sort());
    expect(h.deps.stages.removeWorkspace).toHaveBeenCalledTimes(1); // the Run's own, at the end

    // PRs wait for the repair phase, then go in diagnosis order, built from the Run's own workspace.
    expect(h.open.mock.calls.map(([input]) => input.diagnosis.id)).toEqual(["diag_1", "diag_2", "diag_3", "diag_4", "diag_5"]);
    expect(h.open.mock.calls.every(([input]) => input.workspace.path === "/workspaces/run_x/repo")).toBe(true);

    // Interleaved console lines say which diagnosis they belong to.
    expect(h.lines).toContain(`[${run.id}]   [diag_3] diagnosis diag_3 (fnd_sqli)`);
    expect(h.lines).toContain(`[${run.id}]     [diag_3] ok   read_file: read src/db.js (12 lines)`);
    expect(h.lines).toContain(`[${run.id}]     [diag_3] attempt 2: patch diag_3_patch_2 verified`);
  });

  it("keeps the run at repair while any diagnosis is being repaired, and at verify only while every one in flight is with the Challenger", async () => {
    const h = parallel(2, "diag_a", "diag_b", "diag_c");
    const gates = new Map<string, { challenge: ReturnType<typeof deferred>; finish: ReturnType<typeof deferred> }>();
    const gate = (id: string) => {
      if (!gates.has(id)) gates.set(id, { challenge: deferred(), finish: deferred() });
      return gates.get(id)!;
    };
    h.deps.stages.repairAndVerify = vi.fn(async ({ diagnosis }: { diagnosis: Diagnosis }, repairDeps: RepairAndVerifyDeps): Promise<RepairAndVerifyResult> => {
      await repairDeps.onProgress?.({ type: "repairing", attempt: 1 });
      await gate(diagnosis.id).challenge.promise;
      const patch = aPatch(`${diagnosis.id}_patch`, diagnosis.id);
      await repairDeps.onProgress?.({ type: "challenging", attempt: 1, patch });
      await gate(diagnosis.id).finish.promise;
      const verified = { ...patch, challengerVerdict: "confirmed" as const, status: "verified" as const };
      await repairDeps.onProgress?.({ type: "attempt-finished", attempt: 1, patch: verified });
      return { patch: verified, attempts: [] };
    });
    const running = processRun(await h.queue(), h.deps);
    const repairStages = async () => {
      await sleep(20);
      return h.moves.slice(2).map((move) => move.split("/")[0]);
    };

    expect(await repairStages()).toEqual(["repair"]); // diag_a and diag_b both being repaired
    gate("diag_a").challenge.resolve();
    expect(await repairStages()).toEqual(["repair"]); // diag_b still is
    gate("diag_b").challenge.resolve();
    expect(await repairStages()).toEqual(["repair", "verify"]); // both with the Challenger
    gate("diag_a").finish.resolve();
    expect(await repairStages()).toEqual(["repair", "verify", "repair"]); // diag_c starts in the freed slot
    gate("diag_c").challenge.resolve();
    expect(await repairStages()).toEqual(["repair", "verify", "repair", "verify"]);
    gate("diag_b").finish.resolve();
    gate("diag_c").finish.resolve();

    expect(await running).toMatchObject({ stage: "done", status: "completed" });
    expect(h.moves).toEqual(["detect/running", "diagnose/running", "repair/running", "verify/running", "repair/running", "verify/running", "done/completed"]);
  });

  it("starts a diagnosis only when the budget covers it on top of every one in flight", async () => {
    const h = parallel(2, "diag_1", "diag_2", "diag_3");
    // Diagnose leaves 39: enough for one diagnosis's worst case (26), not for two at once.
    h.deps.proRequestBudget = 40;
    let inFlight = 0;
    let most = 0;
    const spend = spendingRepair(5);
    h.deps.stages.repairAndVerify = vi.fn(async (input, repairDeps) => {
      most = Math.max(most, ++inFlight);
      const result = await spend(input, repairDeps);
      inFlight--;
      return result;
    });
    const run = await h.queue();
    expect(await processRun(run, h.deps)).toMatchObject({ stage: "done", status: "completed" });

    expect(most).toBe(1);
    expect(h.open).toHaveBeenCalledTimes(3);
    const events = (await h.store.listLogs(run.id)).map((log) => (log.entry as { event?: string }).event);
    expect(events).not.toContain("budget-reached");
  });

  it("stops scheduling when the budget runs out, and lets the diagnoses in flight end on their own", async () => {
    const h = parallel(2, "diag_1", "diag_2", "diag_3", "diag_4");
    h.deps.proRequestBudget = 60;
    h.deps.stages.repairAndVerify = vi.fn(spendingRepair("until-spent"));
    const run = await h.queue();
    expect(await processRun(run, h.deps)).toMatchObject({ stage: "done", status: "completed" });

    expect(h.deps.stages.repairAndVerify).toHaveBeenCalledTimes(2);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.removed).toHaveLength(2);
    const reached = (await h.store.listLogs(run.id)).map((log) => log.entry as Record<string, unknown>).find((entry) => entry.event === "budget-reached");
    expect(reached).toMatchObject({ proLimit: 60, proRequests: 60, verified: 0, diagnosesSkipped: 2 });
    expect(String(reached?.interrupted).split(", ").sort()).toEqual(["diag_1", "diag_2"]);
  });

  it("on a spent daily quota, stops scheduling, lets the rest in flight finish, opens their PRs, then fails the run", async () => {
    const h = parallel(2, "diag_1", "diag_2", "diag_3");
    h.deps.stages.repairAndVerify = vi.fn(async (input, repairDeps) => {
      if (input.diagnosis.id === "diag_2") {
        throw new GeminiError("Rate limit exceeded for model gemini-3.1-pro (limit: 250 requests per day on Tier 1).", 429, false);
      }
      await sleep(30);
      return disputedThenVerified(input, repairDeps);
    });
    const run = await h.queue();
    expect(await processRun(run, h.deps)).toMatchObject({ status: "failed" });

    expect(h.deps.stages.repairAndVerify).toHaveBeenCalledTimes(2); // diag_3 never starts
    expect(h.open.mock.calls.map(([input]) => input.patch.id)).toEqual(["diag_1_patch_2"]);
    const last = (await h.store.listLogs(run.id)).at(-1)?.entry;
    expect(last).toMatchObject({ event: "failed", message: expect.stringContaining("250 requests per day") });
  });

  it("fails the run only when every repair failed", async () => {
    const all = parallel(3, "diag_1", "diag_2", "diag_3");
    all.deps.stages.repairAndVerify = vi.fn(async () => {
      throw new Error("Docker is not running");
    });
    expect(await processRun(await all.queue(), all.deps)).toMatchObject({ stage: "repair", status: "failed" });
    expect(all.removed).toHaveLength(3);

    const some = parallel(3, "diag_1", "diag_2", "diag_3");
    some.deps.stages.repairAndVerify = vi.fn(async (input, repairDeps) => {
      if (input.diagnosis.id !== "diag_2") throw new Error("sandbox timed out");
      return disputedThenVerified(input, repairDeps);
    });
    expect(await processRun(await some.queue(), some.deps)).toMatchObject({ stage: "done", status: "completed" });
  });
});
