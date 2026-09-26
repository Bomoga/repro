import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { seedDemoData } from "../src/seed.ts";
import { InMemoryRunStore } from "../src/store/index.ts";

// The router over real HTTP (Fastify inject), against the in-memory store with the demo data.

let store: InMemoryRunStore;
let app: FastifyInstance;

beforeEach(async () => {
  store = new InMemoryRunStore();
  await seedDemoData(store, { now: new Date("2026-09-26T12:00:00.000Z") });
  app = buildApp(store);
});

async function query(procedure: string, input?: unknown) {
  const qs = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await app.inject({ method: "GET", url: `/trpc/${procedure}${qs}` });
  return { status: res.statusCode, body: res.json() };
}

async function mutate(procedure: string, input: unknown) {
  const res = await app.inject({ method: "POST", url: `/trpc/${procedure}`, payload: input as object });
  return { status: res.statusCode, body: res.json() };
}

class UnreachableStore extends InMemoryRunStore {
  override async ping(): Promise<void> {
    throw new Error("connection refused");
  }
}

describe("health", () => {
  it("reports ok and the store kind over plain HTTP and tRPC", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", store: "memory" });
    expect((await query("health")).body.result.data).toMatchObject({ status: "ok", store: "memory" });
  });

  it("answers 503 when the Run Store is unreachable", async () => {
    const res = await buildApp(new UnreachableStore()).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: "degraded", error: "connection refused" });
  });
});

describe("runs", () => {
  it("lists runs newest first, filtered by status", async () => {
    const all = await query("runs.list");
    expect(all.body.result.data.map((r: { id: string }) => r.id)).toEqual([
      "run_demo_queued",
      "run_demo_repairing",
      "run_demo_completed",
      "run_demo_failed",
    ]);
    const failed = await query("runs.list", { status: "failed" });
    expect(failed.body.result.data.map((r: { id: string }) => r.id)).toEqual(["run_demo_failed"]);
    expect((await query("runs.list", { status: "sleeping" })).status).toBe(400);
  });

  it("summarizes each run with its tallies", async () => {
    const { body } = await query("runs.summaries", { limit: 3 });
    expect(body.result.data).toHaveLength(3);
    expect(body.result.data[2]).toMatchObject({
      run: { id: "run_demo_completed", stage: "done", status: "completed" },
      counts: { findings: 6, reproducible: 4, diagnoses: 3, patches: 5, verifiedPatches: 3 },
    });
  });

  it("returns one run with everything under it, or 404", async () => {
    const { body } = await query("runs.detail", { runId: "run_demo_repairing" });
    const detail = body.result.data;
    expect(detail.run).toMatchObject({ id: "run_demo_repairing", stage: "repair", status: "running" });
    expect(detail.counts).toEqual({ findings: 3, reproducible: 2, diagnoses: 2, patches: 1, verifiedPatches: 0 });
    expect(detail.findings.map((f: { id: string }) => f.id)).toEqual(["fnd_demo_py_sqli", "fnd_demo_py_prompt_logging", "fnd_demo_py_oauth_scopes"]);
    expect(detail.patches[0]).toMatchObject({ id: "patch_demo_py_sqli_1", status: "proposed" });

    expect((await query("runs.detail", { runId: "run_missing" })).status).toBe(404);
    const missing = await query("runs.get", { runId: "run_missing" });
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe("run not found: run_missing");
  });

  it("queues a run from a GitHub ref or an absolute local path", async () => {
    const gh = await mutate("runs.create", { targetRef: "octo/example#main" });
    expect(gh.status).toBe(200);
    expect(gh.body.result.data).toMatchObject({ trigger: "manual", stage: "ingest", status: "queued", target: { kind: "github", ref: "octo/example#main" } });
    expect(await store.getRun(gh.body.result.data.id)).toEqual(gh.body.result.data);

    const local = await mutate("runs.create", { targetRef: "/home/dev/project", targetKind: "local" });
    expect(local.body.result.data).toMatchObject({ target: { kind: "local", ref: "/home/dev/project" } });
  });

  it("refuses a target ingest couldn't take, with a readable reason", async () => {
    const branchOnly = await mutate("runs.create", { targetRef: "main" });
    expect(branchOnly.status).toBe(400);
    expect(branchOnly.body.error.message).toMatch(/^not a GitHub ref/);

    const relative = await mutate("runs.create", { targetRef: "./project", targetKind: "local" });
    expect(relative.status).toBe(400);
    expect(relative.body.error.message).toMatch(/absolute path/);
    expect((await store.listRuns({ status: "queued" })).map((r) => r.id)).toEqual(["run_demo_queued"]);
  });
});

describe("findings, diagnoses, and patches", () => {
  it("lists a run's findings, optionally only the reproduced ones", async () => {
    const all = await query("findings.list", { runId: "run_demo_completed" });
    expect(all.body.result.data).toHaveLength(6);
    const confirmed = await query("findings.list", { runId: "run_demo_completed", reproducible: true });
    expect(confirmed.body.result.data).toHaveLength(4);
    expect(confirmed.body.result.data.every((f: { reproducible: boolean }) => f.reproducible)).toBe(true);
  });

  it("gets single findings, diagnoses, and patches by ID", async () => {
    expect((await query("findings.get", { findingId: "fnd_demo_hardcoded_key" })).body.result.data).toMatchObject({ detectorId: "gitleaks" });
    expect((await query("diagnoses.get", { diagnosisId: "diag_demo_sqli" })).body.result.data.findingIds).toEqual([
      "fnd_demo_sqli_owner",
      "fnd_demo_sqli_note",
    ]);
    expect((await query("patches.get", { patchId: "patch_demo_sqli_2" })).body.result.data).toMatchObject({ status: "verified" });
    expect((await query("diagnoses.list", { runId: "run_demo_completed" })).body.result.data).toHaveLength(3);
    expect((await query("patches.list", { runId: "run_demo_completed" })).body.result.data).toHaveLength(5);
    for (const [procedure, input] of [
      ["findings.get", { findingId: "nope" }],
      ["diagnoses.get", { diagnosisId: "nope" }],
      ["patches.get", { patchId: "nope" }],
    ] as const) {
      expect((await query(procedure, input)).status).toBe(404);
    }
  });

  it("merges a verified patch once, and refuses anything else with 409 or 404", async () => {
    const merge = await mutate("patches.decide", { patchId: "patch_demo_sqli_2", decision: "merge" });
    expect(merge.status).toBe(200);
    expect(merge.body.result.data.status).toBe("merged");

    const again = await mutate("patches.decide", { patchId: "patch_demo_sqli_2", decision: "reject" });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/only a verified patch/);
    expect((await mutate("patches.decide", { patchId: "patch_demo_py_sqli_1", decision: "merge" })).status).toBe(409);
    expect((await mutate("patches.decide", { patchId: "nope", decision: "merge" })).status).toBe(404);
  });

  it("builds a Trust Report that only claims what the patch's own Findings show", async () => {
    const sqli = await query("patches.trustReport", { runId: "run_demo_completed", patchId: "patch_demo_sqli_2" });
    expect(sqli.body.result.data.confidence).toBe("high");
    expect(sqli.body.result.data.reasons).toContain("Addresses a high-severity finding.");

    // Same run has a critical gitleaks Finding, but this patch only addresses a medium one.
    const logging = await query("patches.trustReport", { runId: "run_demo_completed", patchId: "patch_demo_prompt_logging_2" });
    expect(logging.body.result.data.reasons.join(" ")).not.toMatch(/Addresses a (critical|high)/);

    const disputed = await query("patches.trustReport", { runId: "run_demo_completed", patchId: "patch_demo_sqli_1" });
    expect(disputed.body.result.data.confidence).toBe("medium");
  });
});

describe("transport", () => {
  it("serves batched GETs whose path lists several procedures", async () => {
    const procedures = ["runs.summaries", "runs.detail", "findings.list", "diagnoses.list", "patches.list", "health"];
    const input = { 0: {}, 1: { runId: "run_demo_completed" }, 2: { runId: "run_demo_completed" }, 3: { runId: "run_demo_completed" }, 4: { runId: "run_demo_completed" } };
    const res = await app.inject({
      method: "GET",
      url: `/trpc/${procedures.join(",")}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(procedures.length);
  });
});
