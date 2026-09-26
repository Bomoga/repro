import { describe, expect, it } from "vitest";
import { statusCommand } from "../src/commands/status.js";
import { fakeClient } from "./fake-client.js";

function collector() {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

describe("statusCommand", () => {
  it("prints 'no runs yet' when the store is empty and no runId is given", async () => {
    const out = collector();
    await statusCommand(fakeClient({ list: [] }), undefined, out);
    expect(out.lines).toEqual(["no runs yet"]);
  });

  it("lists recent runs when no runId is given", async () => {
    const out = collector();
    const run = { id: "r1", stage: "detect", status: "running", target: { kind: "local", ref: "." }, startedAt: "2026-01-01T00:00:00.000Z" };
    await statusCommand(fakeClient({ list: [run] }), undefined, out);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toContain("r1");
    expect(out.lines[0]).toContain("detect");
  });

  it("reports an unknown run id without throwing", async () => {
    const out = collector();
    await statusCommand(fakeClient({ get: null }), "missing", out);
    expect(out.lines).toEqual(["run not found: missing"]);
  });

  it("prints run detail with finding/diagnosis/patch counts", async () => {
    const out = collector();
    const run = { id: "r1", stage: "verify", status: "running", trigger: "manual", target: { kind: "local", ref: "." }, startedAt: "2026-01-01T00:00:00.000Z" };
    await statusCommand(
      fakeClient({
        get: run,
        findings: [{}, {}],
        diagnoses: [{}],
        patches: [{ status: "merged" }, { status: "proposed" }],
      }),
      "r1",
      out,
    );
    expect(out.lines).toContain("findings  2");
    expect(out.lines).toContain("diagnoses 1");
    expect(out.lines).toContain("patches   2 (1 merged)");
  });
});
