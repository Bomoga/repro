// The Run Store against a real mongod (mongodb-memory-server downloads one on first run and caches
// it under ~/.cache/mongodb-binaries). Never touches Atlas.
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Diagnosis, Finding, Patch, Run } from "../src/contracts.ts";
import {
  CitationError,
  connectStore,
  createRunStore,
  DiagnosisNotFoundError,
  FindingNotFoundError,
  GateNotSatisfiedError,
  InvalidPatchTransitionError,
  NotReproducibleError,
  openConnection,
  RunNotActiveError,
  RunNotFoundError,
  StoreConnectionError,
  StoreError,
  type RunStore,
} from "../src/index.ts";

let mongod: MongoMemoryServer;
let store: RunStore;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  store = createRunStore(await openConnection({ uri: mongod.getUri(), dbName: "repro_test" }));
  await store.ensureIndexes();
}, 180_000);

afterAll(async () => {
  await store?.close();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(store.models).map((model) => model.deleteMany({})));
});

const NOW = "2026-09-26T12:00:00.000Z";

function finding(id: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    detectorId: "semgrep",
    ruleId: "javascript.lang.security.sql-injection",
    severity: "high",
    category: "vulnerability",
    file: "src/db.js",
    lineStart: 10,
    lineEnd: 12,
    message: "User input reaches a SQL query",
    evidence: "db.query(`SELECT * FROM users WHERE id = ${id}`)",
    reproducible: false,
    reproductionCommand: "semgrep --config rule.yml src/db.js",
    createdAt: NOW,
    ...overrides,
  };
}

function diagnosis(id: string, findingIds: string[]): Diagnosis {
  return {
    id,
    findingIds,
    rootCause: "Query strings are built by interpolation",
    proposedStrategy: "Use parameterized queries",
    riskNotes: "CWE-89",
    model: "gemini-3.1-pro-preview",
    createdAt: NOW,
  };
}

function patch(id: string, diagnosisId: string, overrides: Partial<Patch> = {}): Patch {
  return {
    id,
    diagnosisId,
    diff: "diff --git a/src/db.js b/src/db.js\n",
    filesChanged: ["src/db.js"],
    testsPassed: true,
    originalFindingReproduces: false,
    regressionFindings: [],
    challengerVerdict: "confirmed",
    status: "proposed",
    ...overrides,
  };
}

async function newRun(overrides: { id?: string; startedAt?: string } = {}): Promise<Run> {
  return store.runs.create({ target: { kind: "local", ref: "./demo" }, trigger: "manual", ...overrides });
}

// A run with two findings (one confirmed) and a diagnosis citing the confirmed one.
async function seeded() {
  const run = await newRun();
  await store.findings.insert(run.id, [finding("f1"), finding("f2", { file: "src/a.js" })]);
  await store.findings.markReproducible("f1");
  await store.diagnoses.insert(run.id, [diagnosis("d1", ["f1"])]);
  return run;
}

describe("runs", () => {
  it("creates a queued run at ingest, with its log reference, and reads it back as the contract", async () => {
    const run = await newRun({ id: "run_1", startedAt: NOW });
    expect(run).toEqual({
      id: "run_1",
      trigger: "manual",
      target: { kind: "local", ref: "./demo" },
      stage: "ingest",
      status: "queued",
      startedAt: NOW,
      logRef: "run_logs/run_1",
    });
    expect(await store.runs.get("run_1")).toEqual(run);
    expect(await store.runs.get("nope")).toBeNull();
  });

  it("lists newest first, filtered by status or stage", async () => {
    await newRun({ id: "old", startedAt: "2026-09-26T10:00:00.000Z" });
    await newRun({ id: "new", startedAt: "2026-09-26T11:00:00.000Z" });
    await store.runs.setStage("old", "detect");
    expect((await store.runs.list()).map((r) => r.id)).toEqual(["new", "old"]);
    expect((await store.runs.list({ stage: "detect" })).map((r) => r.id)).toEqual(["old"]);
    expect((await store.runs.list({ status: "running" })).map((r) => r.id)).toEqual([]);
    expect(await store.runs.list({ limit: 1 })).toHaveLength(1);
  });

  it("claims the oldest queued run first", async () => {
    await newRun({ id: "second", startedAt: "2026-09-26T11:00:00.000Z" });
    await newRun({ id: "first", startedAt: "2026-09-26T10:00:00.000Z" });
    expect(await store.runs.claimNextQueued()).toMatchObject({ id: "first", status: "running" });
    expect(await store.runs.claimNextQueued()).toMatchObject({ id: "second", status: "running" });
  });

  it("claims each queued run exactly once, even when pollers race", async () => {
    await newRun({ id: "second", startedAt: "2026-09-26T11:00:00.000Z" });
    await newRun({ id: "first", startedAt: "2026-09-26T10:00:00.000Z" });
    const [a, b, c] = await Promise.all([store.runs.claimNextQueued(), store.runs.claimNextQueued(), store.runs.claimNextQueued()]);
    const claimed = [a, b, c].filter((run): run is Run => run !== null);
    expect(claimed.map((r) => r.id).sort()).toEqual(["first", "second"]);
    expect(claimed.every((r) => r.status === "running")).toBe(true);
    expect(await store.runs.claimNextQueued()).toBeNull();
  });

  it("completes at done, fails in place, and never changes once finished", async () => {
    await newRun({ id: "ok" });
    await store.runs.setStage("ok", "verify");
    expect(await store.runs.complete("ok")).toMatchObject({ stage: "done", status: "completed" });

    await newRun({ id: "bad" });
    await store.runs.setStage("bad", "repair");
    expect(await store.runs.fail("bad")).toMatchObject({ stage: "repair", status: "failed" });

    await expect(store.runs.setStage("ok", "repair")).rejects.toThrow(RunNotActiveError);
    await expect(store.runs.setStatus("bad", "running")).rejects.toThrow(RunNotActiveError);
    await expect(store.runs.setStage("missing", "detect")).rejects.toThrow(RunNotFoundError);
    await expect(store.runs.setStage("ok", "done" as never)).rejects.toThrow(StoreError);
    await expect(store.runs.setStatus("bad", "completed" as never)).rejects.toThrow(StoreError);
  });
});

describe("findings", () => {
  it("validates against the contract and requires an existing run", async () => {
    const run = await newRun();
    await expect(store.findings.insert(run.id, [{ ...finding("f1"), severity: "urgent" as never }])).rejects.toThrow();
    await expect(store.findings.insert("missing", [finding("f1")])).rejects.toThrow(RunNotFoundError);
  });

  it("inserts idempotently and never reverts a confirmed finding", async () => {
    const run = await newRun();
    expect(await store.findings.insert(run.id, [finding("f1"), finding("f2")])).toEqual({ inserted: 2, alreadyPresent: 0 });
    await store.findings.markReproducible("f1");
    expect(await store.findings.insert(run.id, [finding("f1"), finding("f3")])).toEqual({ inserted: 1, alreadyPresent: 1 });
    expect((await store.findings.get("f1"))?.reproducible).toBe(true);
  });

  it("refuses an id already stored under another run", async () => {
    const a = await newRun();
    const b = await newRun();
    await store.findings.insert(a.id, [finding("f1")]);
    await expect(store.findings.insert(b.id, [finding("f1")])).rejects.toThrow(/duplicate key/);
  });

  it("returns contract objects with no storage fields, in file order, with filters", async () => {
    const run = await newRun();
    await store.findings.insert(run.id, [
      finding("late", { lineStart: 40 }),
      finding("early", { lineStart: 2 }),
      finding("secret", { detectorId: "gitleaks", file: "src/config.js", reproductionCommand: undefined }),
    ]);
    const all = await store.findings.list(run.id);
    expect(all.map((f) => f.id)).toEqual(["secret", "early", "late"]);
    expect(Object.keys(all[0]!)).not.toContain("runId");
    expect(Object.keys(all[0]!)).not.toContain("_id");
    expect(all[0]).not.toHaveProperty("reproductionCommand");
    expect((await store.findings.list(run.id, { detectorId: "gitleaks" })).map((f) => f.id)).toEqual(["secret"]);
    expect((await store.findings.getMany(["early", "ghost"])).map((f) => f.id)).toEqual(["early"]);
  });

  it("marks reproducible only a finding with a reproduction command", async () => {
    const run = await newRun();
    await store.findings.insert(run.id, [finding("f1"), finding("nocmd", { reproductionCommand: undefined })]);
    expect((await store.findings.markReproducible("f1")).reproducible).toBe(true);
    await expect(store.findings.markReproducible("nocmd")).rejects.toThrow(NotReproducibleError);
    await expect(store.findings.markReproducible("missing")).rejects.toThrow(FindingNotFoundError);
    expect(await store.findings.counts(run.id)).toEqual({ total: 2, reproducible: 1 });
    expect((await store.findings.list(run.id, { reproducible: false })).map((f) => f.id)).toEqual(["nocmd"]);
  });

  it("throws on a field the schema doesn't know, instead of dropping it", async () => {
    const run = await newRun();
    await expect(store.models.Finding.create({ ...finding("f1"), runId: run.id, surprise: true })).rejects.toThrow(/not in schema/);
  });
});

describe("diagnoses", () => {
  it("stores diagnoses whose citations all exist in the same run", async () => {
    const run = await seeded();
    expect(await store.diagnoses.list(run.id)).toEqual([diagnosis("d1", ["f1"])]);
    expect(await store.diagnoses.citing("f1")).toEqual([diagnosis("d1", ["f1"])]);
    expect(await store.diagnoses.citing("f2")).toEqual([]);
  });

  it("rejects a batch with an uncited, unknown, or foreign-run citation, writing nothing", async () => {
    const run = await seeded();
    const other = await newRun();
    await store.findings.insert(other.id, [finding("elsewhere")]);

    await expect(store.diagnoses.insert(run.id, [diagnosis("d2", [])])).rejects.toThrow(CitationError);
    await expect(store.diagnoses.insert(run.id, [diagnosis("d3", ["f2"]), diagnosis("d4", ["f1", "ghost"])])).rejects.toMatchObject({
      name: "CitationError",
      diagnosisId: "d4",
      missingFindingIds: ["ghost"],
    });
    await expect(store.diagnoses.insert(run.id, [diagnosis("d5", ["elsewhere"])])).rejects.toThrow(CitationError);
    expect((await store.diagnoses.list(run.id)).map((d) => d.id)).toEqual(["d1"]);
  });

  it("only lets diagnoses whose findings are all reproducible move on to repair", async () => {
    const run = await seeded();
    await store.diagnoses.insert(run.id, [diagnosis("d2", ["f1", "f2"])]);
    expect((await store.diagnoses.listRepairable(run.id)).map((d) => d.id)).toEqual(["d1"]);
    await store.findings.markReproducible("f2");
    expect((await store.diagnoses.listRepairable(run.id)).map((d) => d.id)).toEqual(["d1", "d2"]);
  });
});

describe("patches", () => {
  it("needs its diagnosis stored in the same run", async () => {
    const run = await seeded();
    const other = await newRun();
    await expect(store.patches.insert(other.id, patch("p1", "d1"))).rejects.toThrow(DiagnosisNotFoundError);
    await expect(store.patches.insert(run.id, patch("p1", "nope"))).rejects.toThrow(DiagnosisNotFoundError);
  });

  it("is never inserted as merged, or as verified without passing the gate", async () => {
    const run = await seeded();
    await expect(store.patches.insert(run.id, patch("p1", "d1", { status: "merged" }))).rejects.toThrow(/human/);
    await expect(
      store.patches.insert(run.id, patch("p2", "d1", { status: "verified", challengerVerdict: "disputed" })),
    ).rejects.toThrow(GateNotSatisfiedError);
    const verified = await store.patches.insert(run.id, patch("p3", "d1", { status: "verified" }));
    expect(verified.status).toBe("verified");
  });

  it("round-trips embedded regression findings and optional fields", async () => {
    const run = await seeded();
    const regressed = patch("p1", "d1", {
      testsPassed: false,
      regressionFindings: [finding("r1", { reproductionCommand: undefined })],
      challengerNotes: "counter-test fails before and after",
      status: "rejected",
    });
    expect(await store.patches.insert(run.id, regressed)).toEqual(regressed);
  });

  it("moves proposed -> verified -> merged, and refuses everything else", async () => {
    const run = await seeded();
    await store.patches.insert(run.id, patch("p1", "d1"));
    expect((await store.patches.transition("p1", "verified")).status).toBe("verified");
    expect((await store.patches.transition("p1", "merged")).status).toBe("merged");
    await expect(store.patches.transition("p1", "rejected")).rejects.toThrow(InvalidPatchTransitionError);
    await expect(store.patches.transition("p1", "merged")).rejects.toThrow(InvalidPatchTransitionError);
    await expect(store.patches.transition("p1", "proposed")).rejects.toThrow(InvalidPatchTransitionError);
  });

  it("won't verify a patch the gate rejects, and says which checks failed", async () => {
    const run = await seeded();
    await store.patches.insert(run.id, patch("p1", "d1", { challengerVerdict: "disputed", originalFindingReproduces: true }));
    await expect(store.patches.transition("p1", "verified")).rejects.toMatchObject({
      name: "GateNotSatisfiedError",
      failedChecks: ["the original finding still reproduces", "the Challenger disputed the patch"],
    });
    expect((await store.patches.transition("p1", "rejected")).status).toBe("rejected");
  });

  it("lets exactly one of a racing merge and reject win", async () => {
    const run = await seeded();
    await store.patches.insert(run.id, patch("p1", "d1", { status: "verified" }));
    const results = await Promise.allSettled([store.patches.transition("p1", "merged"), store.patches.transition("p1", "rejected")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("records a PR only on a verified or merged patch, and lists by diagnosis and status", async () => {
    const run = await seeded();
    await store.patches.insert(run.id, patch("p1", "d1", { status: "rejected", testsPassed: false }));
    await store.patches.insert(run.id, patch("p2", "d1", { status: "verified" }));
    await expect(store.patches.setPrUrl("p1", "https://github.com/o/r/pull/1")).rejects.toThrow(/rejected/);
    expect((await store.patches.setPrUrl("p2", "https://github.com/o/r/pull/2")).prUrl).toBe("https://github.com/o/r/pull/2");
    expect((await store.patches.listByDiagnosis("d1")).map((p) => p.id)).toEqual(["p1", "p2"]);
    expect((await store.patches.listByStatus("verified")).map((p) => p.id)).toEqual(["p2"]);
    expect((await store.patches.list(run.id, { status: ["verified", "merged"] })).map((p) => p.id)).toEqual(["p2"]);
  });
});

describe("run logs", () => {
  it("keeps every entry, in order, through the background writer", async () => {
    const run = await newRun();
    const log = store.logs.writer(run.id);
    log.record({ at: NOW, role: "diagnose", request: { responseSchema: { $schema: "https://json-schema.org/draft/2020-12/schema" } } });
    log.record({ role: "repair", attempt: 1 });
    await log.flush();
    const entries = await store.logs.list(run.id);
    expect(entries.map((e) => (e.entry as { role: string }).role)).toEqual(["diagnose", "repair"]);
    expect(entries[0]).toMatchObject({ at: NOW, kind: "gemini" });
    expect(entries[0]!.entry).toMatchObject({ request: { responseSchema: { $schema: expect.any(String) } } });
  });
});

describe("connectStore", () => {
  it("shares one store per URI and database until it is closed", async () => {
    const options = { uri: mongod.getUri(), dbName: "repro_cache" };
    const [a, b] = await Promise.all([connectStore(options), connectStore(options)]);
    expect(a).toBe(b);
    await a.close();
    const c = await connectStore(options);
    expect(c).not.toBe(a);
    await c.close();
  });

  it("explains a server it can't reach, without the password", async () => {
    const failure = connectStore({ uri: "mongodb://lane1:hunter2@127.0.0.1:1/repro", serverSelectionTimeoutMS: 300 });
    await expect(failure).rejects.toThrow(StoreConnectionError);
    await expect(failure).rejects.toThrow(/Network Access/);
    await expect(failure).rejects.not.toThrow(/hunter2/);
  });
});
