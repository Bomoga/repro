import { describe, expect, it, beforeEach } from "vitest";
import { buildApp } from "../src/app.ts";
import { InMemoryRunStore } from "../src/store/index.ts";
import type { Diagnosis, Finding, Patch } from "@repro/contracts";

const finding: Finding = {
  id: "fnd_1",
  detectorId: "semgrep",
  ruleId: "javascript.express.security.audit.xss",
  severity: "high",
  category: "vulnerability",
  file: "server/index.js",
  lineStart: 12,
  lineEnd: 12,
  message: "User input written directly to the response",
  evidence: "res.send(req.query.name);",
  reproducible: true,
  reproductionCommand: "node repro.js",
  reproductionOutput: "REPRODUCED",
  createdAt: new Date().toISOString(),
};

const diagnosis: Diagnosis = {
  id: "diag_1",
  findingIds: [finding.id],
  rootCause: "Unescaped user input reaches the response body",
  proposedStrategy: "Escape or template the response",
  riskNotes: "Low risk, contained to one route",
  model: "gemini-3.1-pro-preview",
  createdAt: new Date().toISOString(),
};

const patch: Patch = {
  id: "patch_1",
  diagnosisId: diagnosis.id,
  diff: "--- a/server/index.js\n+++ b/server/index.js\n",
  filesChanged: ["server/index.js"],
  testsPassed: true,
  originalFindingReproduces: false,
  regressionFindings: [],
  challengerVerdict: "confirmed",
  status: "verified",
};

async function seededStore(): Promise<InMemoryRunStore> {
  const store = new InMemoryRunStore();
  await store.insertRun({
    id: "run_1",
    trigger: "manual",
    target: { kind: "github", ref: "octo/example" },
    stage: "verify",
    status: "blocked",
    startedAt: new Date().toISOString(),
    logRef: "run_logs/run_1",
  });
  await store.addFindings("run_1", [finding]);
  await store.addDiagnoses("run_1", [diagnosis]);
  await store.savePatch("run_1", patch);
  return store;
}

describe("api", () => {
  it("responds to /health", async () => {
    const app = buildApp(new InMemoryRunStore());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("lists runs via tRPC", async () => {
    const app = buildApp(await seededStore());
    const res = await app.inject({ method: "GET", url: "/trpc/runs.list" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.data).toHaveLength(1);
    expect(body.result.data[0].id).toBe("run_1");
  });

  it("gets a run's findings, diagnoses, and patches", async () => {
    const app = buildApp(await seededStore());
    const input = encodeURIComponent(JSON.stringify({ runId: "run_1" }));

    const findingsRes = await app.inject({ method: "GET", url: `/trpc/findings.list?input=${input}` });
    expect(findingsRes.json().result.data).toHaveLength(1);

    const diagnosesRes = await app.inject({ method: "GET", url: `/trpc/diagnoses.list?input=${input}` });
    expect(diagnosesRes.json().result.data).toHaveLength(1);

    const patchesRes = await app.inject({ method: "GET", url: `/trpc/patches.list?input=${input}` });
    expect(patchesRes.json().result.data).toHaveLength(1);
  });

  it("404s a missing run", async () => {
    const app = buildApp(new InMemoryRunStore());
    const input = encodeURIComponent(JSON.stringify({ runId: "nope" }));
    const res = await app.inject({ method: "GET", url: `/trpc/runs.get?input=${input}` });
    expect(res.statusCode).toBe(404);
  });

  it("merges a verified patch and refuses deciding twice with 409", async () => {
    const app = buildApp(await seededStore());
    const merge = await app.inject({
      method: "POST",
      url: "/trpc/patches.decide",
      payload: { patchId: "patch_1", decision: "merge" },
    });
    expect(merge.statusCode).toBe(200);
    expect(merge.json().result.data.status).toBe("merged");

    const again = await app.inject({
      method: "POST",
      url: "/trpc/patches.decide",
      payload: { patchId: "patch_1", decision: "reject" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("creates a run from a target ref only", async () => {
    const app = buildApp(new InMemoryRunStore());
    const res = await app.inject({
      method: "POST",
      url: "/trpc/runs.create",
      payload: { targetRef: "main" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.data).toMatchObject({ status: "queued", stage: "ingest" });
  });
});
