import { describe, expect, it } from "vitest";
import { MemoryRunStore } from "../src/run-store/memory-store.js";
import { RunNotFoundError } from "../src/run-store/store.js";
import type { Run } from "@repro/contracts";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    trigger: "manual",
    target: { kind: "local", ref: "." },
    stage: "ingest",
    status: "queued",
    startedAt: new Date().toISOString(),
    logRef: "",
    ...overrides,
  };
}

describe("MemoryRunStore", () => {
  it("updates only the given fields on a run", async () => {
    const store = new MemoryRunStore();
    await store.createRun(makeRun());
    const updated = await store.updateRun("r1", { stage: "detect", status: "running" });
    expect(updated).toMatchObject({ id: "r1", stage: "detect", status: "running", trigger: "manual" });
  });

  it("returns null updating a run that doesn't exist", async () => {
    const store = new MemoryRunStore();
    expect(await store.updateRun("missing", { status: "running" })).toBeNull();
  });

  it("throws RunNotFoundError adding findings to an unknown run", async () => {
    const store = new MemoryRunStore();
    await expect(store.addFindings("missing", [])).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("lists runs newest first", async () => {
    const store = new MemoryRunStore();
    await store.createRun(makeRun({ id: "old", startedAt: "2026-01-01T00:00:00.000Z" }));
    await store.createRun(makeRun({ id: "new", startedAt: "2026-06-01T00:00:00.000Z" }));
    const runs = await store.listRuns();
    expect(runs.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("respects the limit option", async () => {
    const store = new MemoryRunStore();
    await store.createRun(makeRun({ id: "a", startedAt: "2026-01-01T00:00:00.000Z" }));
    await store.createRun(makeRun({ id: "b", startedAt: "2026-02-01T00:00:00.000Z" }));
    const runs = await store.listRuns({ limit: 1 });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe("b");
  });

  it("updates a single patch by id without disturbing others", async () => {
    const store = new MemoryRunStore();
    await store.createRun(makeRun());
    const patchBase = {
      diagnosisId: "d1",
      diff: "",
      filesChanged: [],
      testsPassed: false,
      originalFindingReproduces: true,
      regressionFindings: [],
      challengerVerdict: "disputed" as const,
      status: "proposed" as const,
    };
    await store.addPatch("r1", { id: "p1", ...patchBase });
    await store.addPatch("r1", { id: "p2", ...patchBase });

    const updated = await store.updatePatch("r1", "p1", { status: "merged" });
    expect(updated?.status).toBe("merged");

    const patches = await store.listPatches("r1");
    expect(patches.find((p) => p.id === "p2")?.status).toBe("proposed");
  });
});
