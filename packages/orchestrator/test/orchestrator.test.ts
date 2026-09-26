import { describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.ts";
import { aWorkspace, harness } from "./helpers.ts";

describe("Orchestrator", () => {
  it("claims queued runs oldest first, one at a time, and says when none is left", async () => {
    const { store, deps } = harness();
    // Finding IDs are unique across the store; these runs don't need any.
    deps.stages.detect = vi.fn(async () => ({ findings: [], failures: [], droppedOutsideIndex: 0 }));
    const older = await store.insertRun({
      id: "run_older",
      trigger: "manual",
      target: { kind: "github", ref: "octo/example" },
      stage: "ingest",
      status: "queued",
      startedAt: "2026-09-26T09:00:00.000Z",
      logRef: "run_logs/run_older",
    });
    const newer = await store.createRun({ target: { kind: "github", ref: "octo/other" }, trigger: "manual" });
    const orchestrator = new Orchestrator(deps);

    expect(await orchestrator.runNext()).toBe(true);
    expect(await store.getRun(older.id)).toMatchObject({ status: "completed" });
    expect(await store.getRun(newer.id)).toMatchObject({ status: "queued" });
    expect(await orchestrator.runNext()).toBe(true);
    expect(await store.getRun(newer.id)).toMatchObject({ status: "completed" });
    expect(await orchestrator.runNext()).toBe(false);
  });

  it("polls until shut down, and fails the run in flight instead of leaving it running", async () => {
    const { store, deps } = harness();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    deps.stages.ingest = vi.fn(async (runId: string) => {
      await held;
      return aWorkspace({ runId });
    });
    const orchestrator = new Orchestrator({ ...deps, pollIntervalMs: 5 });
    const loop = orchestrator.start();

    const run = await store.createRun({ target: { kind: "github", ref: "octo/example" }, trigger: "manual" });
    await vi.waitFor(async () => expect(await store.getRun(run.id)).toMatchObject({ status: "running" }));
    await orchestrator.shutdown();
    expect(await store.getRun(run.id)).toMatchObject({ stage: "ingest", status: "failed" });
    expect((await store.listLogs(run.id)).map((l) => l.entry)).toContainEqual({ event: "failed", message: "the orchestrator shut down mid-run" });

    release();
    await loop;
    // The abandoned pipeline finishing late can't revive the run.
    expect(await store.getRun(run.id)).toMatchObject({ status: "failed" });
  });

  it("keeps polling after the store fails a claim", async () => {
    const { store, deps, lines } = harness();
    const claim = store.claimNextQueued.bind(store);
    let calls = 0;
    store.claimNextQueued = async () => (++calls === 1 ? Promise.reject(new Error("store unreachable")) : claim());
    const orchestrator = new Orchestrator({ ...deps, pollIntervalMs: 5 });
    const loop = orchestrator.start();

    const run = await store.createRun({ target: { kind: "github", ref: "octo/example" }, trigger: "manual" });
    await vi.waitFor(async () => expect(await store.getRun(run.id)).toMatchObject({ status: "completed" }));
    await orchestrator.shutdown();
    await loop;
    expect(lines).toContain("orchestrator: store unreachable");
  });
});
