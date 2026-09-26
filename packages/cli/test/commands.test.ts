import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "@repro/api";
import { InMemoryRunStore } from "@repro/api";
import { ApiClient } from "../src/client.ts";
import { runDecide, runScan, runStatus, runWatch } from "../src/commands.ts";

let app: Awaited<ReturnType<typeof buildApp>>;
let client: ApiClient;
let lines: string[];
const io = { log: (line: string) => lines.push(line) };

beforeAll(async () => {
  app = buildApp(new InMemoryRunStore());
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  client = new ApiClient(`http://127.0.0.1:${port}`);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  lines = [];
});

describe("cli commands against a real running API", () => {
  it("reports no runs yet", async () => {
    lines = [];
    await runStatus(client, io, undefined);
    expect(lines.join("\n")).toContain("No runs yet");
  });

  it("scans, watches to completion, and reports status", async () => {
    lines = [];
    await runScan(client, io, "main", "github");
    const runId = lines[0]!.match(/Queued (\S+)/)![1]!;

    lines = [];
    await runWatch(client, io, runId, { intervalMs: 0, maxIterations: 1 });
    expect(lines[0]).toContain("queued");

    lines = [];
    await runStatus(client, io, runId);
    expect(lines[0]).toContain(runId);
    expect(lines[1]).toContain("0 finding(s)");
  });

  it("rejects deciding a patch that isn't verified", async () => {
    await expect(runDecide(client, io, "does-not-exist", "merge")).rejects.toThrow();
  });
});
