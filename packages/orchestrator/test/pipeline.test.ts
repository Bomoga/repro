import { describe, expect, it, vi } from "vitest";
import { GeminiError } from "@repro/agents";
import type { InMemoryRunStore } from "@repro/api";
import { PRO_REQUESTS_PER_DIAGNOSIS, processRun } from "../src/pipeline.ts";
import type { PullRequestInput } from "../src/pull-request.ts";
import { aDiagnosis, disputedThenVerified, harness, sdkBackedGemini, spendingRepair } from "./helpers.ts";

describe("processRun", () => {
  it("takes a claimed run through every stage and ends it completed at done", async () => {
    const { store, deps, moves, queue } = harness();
    const claimed = await queue();
    const done = await processRun(claimed, deps);

    expect(done).toMatchObject({ id: claimed.id, stage: "done", status: "completed" });
    // Stage is what's in flight: repair and verify alternate across the two attempts.
    expect(moves).toEqual(["detect/running", "diagnose/running", "repair/running", "verify/running", "repair/running", "verify/running", "done/completed"]);

    expect(await store.listFindings(claimed.id)).toMatchObject([
      { id: "fnd_sqli", reproducible: true, reproductionOutput: "REPRODUCED semgrep sqli at src/db.js:6-7" },
      { id: "fnd_style", reproducible: false },
    ]);
    expect((await store.listDiagnoses(claimed.id)).map((d) => d.id)).toEqual(["diag_sqli", "diag_style"]);
    // Only the diagnosis whose findings all reproduced goes to Repair.
    expect(deps.stages.repairAndVerify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.stages.repairAndVerify).mock.calls[0]![0].diagnosis.id).toBe("diag_sqli");
    expect((await store.listPatches(claimed.id)).map((p) => [p.id, p.status])).toEqual([
      ["diag_sqli_patch_1", "rejected"],
      ["diag_sqli_patch_2", "verified"],
    ]);
    expect(deps.stages.removeWorkspace).toHaveBeenCalledWith(expect.objectContaining({ runId: claimed.id }));
  });

  it("shows each attempt's patch while the Challenger is still on it", async () => {
    const { store, deps, queue } = harness();
    const claimed = await queue();
    const seen: string[] = [];
    deps.stages.repairAndVerify = vi.fn(async (input, repairDeps) =>
      disputedThenVerified(input, {
        ...repairDeps,
        onProgress: async (progress) => {
          await repairDeps.onProgress?.(progress);
          if (progress.type === "challenging") seen.push(...(await store.listPatches(claimed.id)).map((p) => `${p.id}:${p.status}`));
        },
      }),
    );
    await processRun(claimed, deps);
    expect(seen).toEqual(["diag_sqli_patch_1:proposed", "diag_sqli_patch_1:rejected", "diag_sqli_patch_2:proposed"]);
  });

  it("keeps the run's log: its events, tool calls, counter-tests, and every Gemini interaction", async () => {
    const { store, deps, queue } = harness();
    const claimed = await queue();
    await processRun(claimed, deps);
    const logs = await store.listLogs(claimed.id);

    const events = logs.filter((l) => l.kind === "orchestrator").map((l) => (l.entry as { event: string }).event);
    expect(events).toEqual([
      "ingested",
      "stage",
      "detected",
      "reproduced",
      "stage",
      "diagnosed",
      "stage",
      "tool-call",
      "stage",
      "counter-test",
      "stage",
      "stage",
      "gemini-requests",
      "completed",
    ]);
    expect(logs.find((l) => (l.entry as { event?: string }).event === "detected")?.entry).toMatchObject({
      findings: 2,
      failures: [{ detectorId: "osv-scanner", message: "osv-scanner exited 2" }],
    });
    expect(logs.filter((l) => l.kind === "gemini")).toEqual([expect.objectContaining({ entry: expect.objectContaining({ role: "diagnose" }) })]);
  });

  it("fails the run in the stage that broke, logs why, and still removes the workspace", async () => {
    const { store, deps, queue } = harness();
    deps.stages.diagnose = vi.fn(async () => {
      throw new Error("Gemini quota exhausted");
    });
    const claimed = await queue();
    const failed = await processRun(claimed, deps);

    expect(failed).toMatchObject({ stage: "diagnose", status: "failed" });
    expect((await store.listLogs(claimed.id)).at(-1)?.entry).toEqual({ event: "failed", stage: "diagnose", message: "Gemini quota exhausted" });
    expect(deps.stages.removeWorkspace).toHaveBeenCalled();
  });

  it("fails at ingest with no workspace to remove", async () => {
    const { deps, queue } = harness();
    deps.stages.ingest = vi.fn(async () => {
      throw new Error("local path does not exist: /nowhere");
    });
    const failed = await processRun(await queue(), deps);
    expect(failed).toMatchObject({ stage: "ingest", status: "failed" });
    expect(deps.stages.removeWorkspace).not.toHaveBeenCalled();
  });

  it("completes without diagnosing when the detectors find nothing, and without repairing when nothing reproduces", async () => {
    const nothing = harness();
    nothing.deps.stages.detect = vi.fn(async () => ({ findings: [], failures: [], droppedOutsideIndex: 0 }));
    expect(await processRun(await nothing.queue(), nothing.deps)).toMatchObject({ stage: "done", status: "completed" });
    expect(nothing.deps.stages.diagnose).not.toHaveBeenCalled();

    const unconfirmed = harness();
    unconfirmed.deps.stages.reproduce = vi.fn(async (findings) => ({ findings, attempts: [] }));
    expect(await processRun(await unconfirmed.queue(), unconfirmed.deps)).toMatchObject({ stage: "done", status: "completed" });
    expect(unconfirmed.deps.stages.diagnose).toHaveBeenCalled();
    expect(unconfirmed.deps.stages.repairAndVerify).not.toHaveBeenCalled();
  });

  it("without a Gemini client, keeps the reproduced findings and completes without diagnosing", async () => {
    const { store, deps, moves, queue } = harness();
    const claimed = await queue();
    const done = await processRun(claimed, { ...deps, gemini: undefined });

    expect(done).toMatchObject({ stage: "done", status: "completed" });
    expect(moves).toEqual(["detect/running", "done/completed"]);
    expect(await store.listFindings(claimed.id)).toMatchObject([{ id: "fnd_sqli", reproducible: true }, { id: "fnd_style", reproducible: false }]);
    expect(deps.stages.diagnose).not.toHaveBeenCalled();
    expect(deps.stages.repairAndVerify).not.toHaveBeenCalled();
  });

  it("keeps going past a repair that throws, and fails the run only when every repair did", async () => {
    const twoRepairable = () => {
      const h = harness();
      h.deps.stages.diagnose = vi.fn(async () => ({
        diagnoses: [aDiagnosis("diag_a", ["fnd_sqli"]), aDiagnosis("diag_b", ["fnd_sqli"])],
        dropped: [],
        uncoveredFindingIds: [],
        attempts: 1,
      }));
      return h;
    };

    const one = twoRepairable();
    one.deps.stages.repairAndVerify = vi.fn(async (input, repairDeps) => {
      if (input.diagnosis.id === "diag_a") throw new Error("sandbox timed out");
      return disputedThenVerified(input, repairDeps);
    });
    const oneRun = await one.queue();
    expect(await processRun(oneRun, one.deps)).toMatchObject({ status: "completed" });
    expect((await one.store.listPatches(oneRun.id)).map((p) => p.status)).toEqual(["rejected", "verified"]);

    const all = twoRepairable();
    all.deps.stages.repairAndVerify = vi.fn(async () => {
      throw new Error("Docker is not running");
    });
    expect(await processRun(await all.queue(), all.deps)).toMatchObject({ stage: "repair", status: "failed" });

    // A spent daily quota ends the run at once: diag_b never starts.
    const quota = twoRepairable();
    quota.deps.stages.repairAndVerify = vi.fn(async () => {
      throw new GeminiError("Rate limit exceeded for model gemini-3.1-pro (limit: 250 requests per day on Tier 1).", 429, false);
    });
    const quotaRun = await quota.queue();
    expect(await processRun(quotaRun, quota.deps)).toMatchObject({ stage: "repair", status: "failed" });
    expect(quota.deps.stages.repairAndVerify).toHaveBeenCalledTimes(1);
    const failed = (await quota.store.listLogs(quotaRun.id)).find((log) => (log.entry as { event?: string }).event === "failed");
    expect(failed?.entry).toMatchObject({ stage: "repair", message: expect.stringContaining("250 requests per day") });
  });

  it("opens a PR for each verified patch and records its URL; a PR that fails doesn't fail the run", async () => {
    const opened = harness();
    const open = vi.fn(async (_input: PullRequestInput) => "https://github.com/octo/example/pull/7");
    opened.deps.pullRequests = { open };
    const run = await opened.queue();
    await processRun(run, opened.deps);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toMatchObject({ patch: { id: "diag_sqli_patch_2", status: "verified" }, diagnosis: { id: "diag_sqli" } });
    expect(await opened.store.getPatch("diag_sqli_patch_2")).toMatchObject({ status: "verified", prUrl: "https://github.com/octo/example/pull/7" });

    const refused = harness();
    refused.deps.pullRequests = { open: vi.fn(async () => Promise.reject(new Error("GitHub said 403"))) };
    const refusedRun = await refused.queue();
    expect(await processRun(refusedRun, refused.deps)).toMatchObject({ status: "completed" });
    expect(await refused.store.getPatch("diag_sqli_patch_2")).not.toHaveProperty("prUrl");
    expect((await refused.store.listLogs(refusedRun.id)).map((l) => (l.entry as { event?: string }).event)).toContain("pull-request-failed");
  });

  it("keeps the workspace when asked to", async () => {
    const { deps, queue } = harness();
    deps.keepWorkspace = true;
    await processRun(await queue(), deps);
    expect(deps.stages.removeWorkspace).not.toHaveBeenCalled();
  });
});

describe("processRun when Gemini requests run short", () => {
  /** Diagnoses that all cite the reproduced finding, on the real wrapper, with a PR opener. */
  const repairable = (...ids: string[]) => {
    const h = harness();
    h.deps.stages.diagnose = vi.fn(async (_input, { gemini }) => {
      await gemini.interact({ role: "diagnose", systemInstruction: "diagnose", input: "findings" });
      return { diagnoses: ids.map((id) => aDiagnosis(id, ["fnd_sqli"])), dropped: [], uncoveredFindingIds: [], attempts: 1 };
    });
    h.deps.gemini = sdkBackedGemini();
    const open = vi.fn(async (input: PullRequestInput) => `https://github.com/octo/example/pull/${input.diagnosis.id}`);
    h.deps.pullRequests = { open };
    return { ...h, open };
  };
  const events = async (store: InMemoryRunStore, runId: string) =>
    (await store.listLogs(runId)).filter((l) => l.kind === "orchestrator").map((l) => l.entry as { event: string } & Record<string, unknown>);

  it("stops scheduling repairs the budget can't cover, opens PRs for what's verified, and completes", async () => {
    const h = repairable("diag_a", "diag_b", "diag_c");
    h.deps.proRequestBudget = 30;
    h.deps.stages.repairAndVerify = vi.fn(spendingRepair(10));
    const run = await h.queue();
    expect(await processRun(run, h.deps)).toMatchObject({ stage: "done", status: "completed" });

    // Diagnose's 1 and diag_a's 10 leave 19, short of one diagnosis's worst case.
    expect(PRO_REQUESTS_PER_DIAGNOSIS).toBe(26);
    expect(h.deps.stages.repairAndVerify).toHaveBeenCalledTimes(1);
    expect(h.open.mock.calls.map(([input]) => input.patch.id)).toEqual(["diag_a_patch_2"]);
    const logged = await events(h.store, run.id);
    expect(logged.find((e) => e.event === "budget-reached")).toEqual({
      event: "budget-reached",
      proLimit: 30,
      proRequests: 11,
      byModel: { "gemini-3.1-pro-preview": 11 },
      verified: 1,
      diagnosesSkipped: 2,
    });
    expect(logged.map((e) => e.event).slice(-4)).toEqual(["budget-reached", "pull-request", "gemini-requests", "completed"]);
    expect(logged.at(-2)).toEqual({ event: "gemini-requests", byModel: { "gemini-3.1-pro-preview": 11 }, proRequests: 11, proLimit: 30 });
  });

  it("stops the same way when the budget runs out in the middle of a diagnosis", async () => {
    const h = repairable("diag_a", "diag_b", "diag_c");
    h.deps.proRequestBudget = 32;
    h.deps.stages.repairAndVerify = vi.fn(async (input, repairDeps) =>
      spendingRepair(input.diagnosis.id === "diag_a" ? 5 : "until-spent")(input, repairDeps),
    );
    const run = await h.queue();
    expect(await processRun(run, h.deps)).toMatchObject({ stage: "done", status: "completed" });

    expect(h.deps.stages.repairAndVerify).toHaveBeenCalledTimes(2);
    expect(h.open).toHaveBeenCalledTimes(1);
    const logged = await events(h.store, run.id);
    expect(logged.find((e) => e.event === "budget-reached")).toMatchObject({ proRequests: 32, verified: 1, diagnosesSkipped: 1, interrupted: "diag_b" });
    expect(logged.map((e) => e.event)).not.toContain("repair-failed");
  });

  it("on a spent daily quota, stops scheduling, opens PRs for what's verified, then fails the run", async () => {
    const h = repairable("diag_a", "diag_b", "diag_c");
    h.deps.stages.repairAndVerify = vi.fn(async (input, repairDeps) => {
      if (input.diagnosis.id === "diag_b") {
        throw new GeminiError("Rate limit exceeded for model gemini-3.1-pro (limit: 250 requests per day on Tier 1).", 429, false);
      }
      return disputedThenVerified(input, repairDeps);
    });
    const run = await h.queue();
    expect(await processRun(run, h.deps)).toMatchObject({ stage: "repair", status: "failed" });

    expect(h.deps.stages.repairAndVerify).toHaveBeenCalledTimes(2); // diag_c never starts
    expect(h.open.mock.calls.map(([input]) => input.patch.id)).toEqual(["diag_a_patch_2"]);
    expect(await h.store.getPatch("diag_a_patch_2")).toMatchObject({ prUrl: "https://github.com/octo/example/pull/diag_a" });
    const logged = await events(h.store, run.id);
    expect(logged.map((e) => e.event).slice(-3)).toEqual(["pull-request", "gemini-requests", "failed"]);
    expect(logged.at(-1)).toMatchObject({ stage: "repair", message: expect.stringContaining("250 requests per day") });
  });
});
