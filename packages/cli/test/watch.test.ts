import { describe, expect, it, vi } from "vitest";
import { watchCommand } from "../src/commands/watch.js";
import type { ReproClient } from "../src/client.js";

function collector() {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

function clientWithSequence(runs: unknown[]): ReproClient {
  const query = vi.fn();
  for (const run of runs) query.mockResolvedValueOnce(run);
  return { runs: { get: { query } } } as unknown as ReproClient;
}

describe("watchCommand", () => {
  it("stops as soon as the run reaches a terminal status", async () => {
    const out = collector();
    const client = clientWithSequence([
      { id: "r1", stage: "detect", status: "running" },
      { id: "r1", stage: "verify", status: "running" },
      { id: "r1", stage: "done", status: "completed" },
    ]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await watchCommand(client, "r1", { sleep, maxIterations: 10 }, out);
    expect(out.lines).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("prints nothing new when stage and status don't change between polls", async () => {
    const out = collector();
    const client = clientWithSequence([
      { id: "r1", stage: "detect", status: "running" },
      { id: "r1", stage: "detect", status: "running" },
      { id: "r1", stage: "done", status: "failed" },
    ]);
    await watchCommand(client, "r1", { sleep: vi.fn().mockResolvedValue(undefined), maxIterations: 10 }, out);
    expect(out.lines).toHaveLength(2);
  });

  it("reports an unknown run and returns immediately", async () => {
    const out = collector();
    const client = clientWithSequence([null]);
    await watchCommand(client, "missing", { sleep: vi.fn() }, out);
    expect(out.lines).toEqual(["run not found: missing"]);
  });

  it("gives up after maxIterations if the run never reaches a terminal status", async () => {
    const out = collector();
    const client = { runs: { get: { query: vi.fn().mockResolvedValue({ id: "r1", stage: "detect", status: "running" }) } } } as unknown as ReproClient;
    const sleep = vi.fn().mockResolvedValue(undefined);
    await watchCommand(client, "r1", { sleep, maxIterations: 3 }, out);
    expect(sleep).toHaveBeenCalledTimes(3);
  });
});
