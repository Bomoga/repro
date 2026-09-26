import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryRunStore } from "../src/run-store/memory-store.js";

describe("buildApp", () => {
  it("responds to GET /health", async () => {
    const app = buildApp({ store: new MemoryRunStore() });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
  });

  it("serves the tRPC health query at /trpc/health", async () => {
    const app = buildApp({ store: new MemoryRunStore() });
    const response = await app.inject({ method: "GET", url: "/trpc/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.data).toMatchObject({ ok: true });
  });

  it("creates a run over tRPC and reads it back from the same store", async () => {
    const store = new MemoryRunStore();
    const app = buildApp({ store });
    const create = await app.inject({
      method: "POST",
      url: "/trpc/runs.create",
      payload: { trigger: "manual", target: { kind: "local", ref: "." } },
    });
    expect(create.statusCode).toBe(200);
    const runId = create.json().result.data.id as string;

    const get = await app.inject({ method: "GET", url: `/trpc/runs.get?input=${encodeURIComponent(JSON.stringify({ id: runId }))}` });
    expect(get.json().result.data.id).toBe(runId);
  });
});
