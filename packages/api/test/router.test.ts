import { beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../src/router/index.js";
import { MemoryRunStore } from "../src/run-store/memory-store.js";
import type { Diagnosis, Finding, Patch } from "@repro/contracts";

describe("appRouter", () => {
  let store: MemoryRunStore;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    store = new MemoryRunStore();
    caller = appRouter.createCaller({ store });
  });

  it("reports healthy", async () => {
    const result = await caller.health();
    expect(result.ok).toBe(true);
  });

  it("creates a run and lists it back", async () => {
    const created = await caller.runs.create({ trigger: "manual", target: { kind: "local", ref: "." } });
    expect(created.status).toBe("queued");
    expect(created.stage).toBe("ingest");

    const list = await caller.runs.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);

    const fetched = await caller.runs.get({ id: created.id });
    expect(fetched?.id).toBe(created.id);
  });

  it("returns null for an unknown run id", async () => {
    const fetched = await caller.runs.get({ id: "does-not-exist" });
    expect(fetched).toBeNull();
  });

  it("lists findings, diagnoses, and patches scoped to a run", async () => {
    const run = await caller.runs.create({ trigger: "manual", target: { kind: "local", ref: "." } });
    const finding: Finding = {
      id: "f1",
      detectorId: "gitleaks",
      ruleId: "generic-api-key",
      severity: "high",
      category: "vulnerability",
      file: "src/config.js",
      lineStart: 3,
      lineEnd: 3,
      message: "hardcoded secret",
      evidence: "const KEY = \"...\"",
      reproducible: true,
      createdAt: new Date().toISOString(),
    };
    const diagnosis: Diagnosis = {
      id: "d1",
      findingIds: ["f1"],
      rootCause: "secret committed to source",
      proposedStrategy: "move to env var",
      riskNotes: "low risk",
      model: "gemini-3.1-pro-preview",
      createdAt: new Date().toISOString(),
    };
    const patch: Patch = {
      id: "p1",
      diagnosisId: "d1",
      diff: "diff --git a/src/config.js b/src/config.js",
      filesChanged: ["src/config.js"],
      testsPassed: true,
      originalFindingReproduces: false,
      regressionFindings: [],
      challengerVerdict: "confirmed",
      status: "verified",
    };

    await store.addFindings(run.id, [finding]);
    await store.addDiagnoses(run.id, [diagnosis]);
    await store.addPatch(run.id, patch);

    await expect(caller.runs.findings({ runId: run.id })).resolves.toEqual([finding]);
    await expect(caller.runs.diagnoses({ runId: run.id })).resolves.toEqual([diagnosis]);
    await expect(caller.runs.patches({ runId: run.id })).resolves.toEqual([patch]);
  });

  it("scopes findings to their own run, never leaking across runs", async () => {
    const runA = await caller.runs.create({ trigger: "manual", target: { kind: "local", ref: "a" } });
    const runB = await caller.runs.create({ trigger: "manual", target: { kind: "local", ref: "b" } });
    await store.addFindings(runA.id, [
      {
        id: "fa",
        detectorId: "semgrep",
        ruleId: "r",
        severity: "low",
        category: "style",
        file: "a.js",
        lineStart: 1,
        lineEnd: 1,
        message: "m",
        evidence: "e",
        reproducible: false,
        createdAt: new Date().toISOString(),
      },
    ]);

    await expect(caller.runs.findings({ runId: runA.id })).resolves.toHaveLength(1);
    await expect(caller.runs.findings({ runId: runB.id })).resolves.toHaveLength(0);
  });
});
