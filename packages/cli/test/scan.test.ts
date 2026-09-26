import { describe, expect, it, vi } from "vitest";
import { scanCommand } from "../src/commands/scan.js";
import type { ReproClient } from "../src/client.js";

function collector() {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

describe("scanCommand", () => {
  it("creates a run with defaults and prints the new run id", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "r1", target: { kind: "local", ref: "." } });
    const client = { runs: { create: { mutate } } } as unknown as ReproClient;
    const out = collector();

    await scanCommand(client, ".", {}, out);

    expect(mutate).toHaveBeenCalledWith({ trigger: "manual", target: { kind: "local", ref: "." } });
    expect(out.lines[0]).toContain("r1");
  });

  it("passes through an explicit kind and trigger", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "r2", target: { kind: "github", ref: "o/r#main" } });
    const client = { runs: { create: { mutate } } } as unknown as ReproClient;

    await scanCommand(client, "o/r#main", { kind: "github", trigger: "webhook" }, collector());

    expect(mutate).toHaveBeenCalledWith({ trigger: "webhook", target: { kind: "github", ref: "o/r#main" } });
  });
});
