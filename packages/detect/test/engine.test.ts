import type { DetectorAdapter, Finding } from "@repro/contracts";
import { describe, expect, it } from "vitest";
import { detect } from "../src/engine.ts";
import { FakeExecutor, seededWorkspace } from "./helpers.ts";

const base: Finding = {
  id: "fnd_a",
  detectorId: "fake",
  ruleId: "r",
  severity: "low",
  category: "style",
  file: "server/index.js",
  lineStart: 1,
  lineEnd: 1,
  message: "m",
  evidence: "e",
  reproducible: false,
  createdAt: "2026-09-26T00:00:00.000Z",
};

const adapter = (id: string, findings: Finding[] | Error): DetectorAdapter => ({
  id,
  run: async () => {
    if (findings instanceof Error) throw findings;
    return findings;
  },
});

describe("detect", () => {
  const exec = new FakeExecutor(() => ({}));

  it("never lets a Finding leave Detect already confirmed", async () => {
    const cheating = { ...base, reproducible: true, reproductionOutput: "trust me" };
    const { findings } = await detect(seededWorkspace, exec, [adapter("fake", [cheating])]);
    expect(findings).toEqual([base]);
  });

  it("reports a failing adapter instead of reading it as zero findings, and keeps the others", async () => {
    const r = await detect(seededWorkspace, exec, [adapter("fake", [base]), adapter("broken", new Error("no docker"))]);
    expect(r.findings).toHaveLength(1);
    expect(r.failures).toEqual([{ detectorId: "broken", message: "no docker" }]);
  });

  it("drops findings outside the ingest-time file index", async () => {
    const r = await detect(seededWorkspace, exec, [adapter("fake", [{ ...base, file: ".git/config" }])]);
    expect(r.findings).toEqual([]);
    expect(r.droppedOutsideIndex).toBe(1);
  });

  it("rejects a Finding claiming another detector's id", async () => {
    const r = await detect(seededWorkspace, exec, [adapter("fake", [{ ...base, detectorId: "semgrep" }])]);
    expect(r.findings).toEqual([]);
    expect(r.failures[0]!.message).toContain("detectorId semgrep");
  });
});
