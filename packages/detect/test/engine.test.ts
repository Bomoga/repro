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

  it("records an invalid Finding as that adapter's failure without losing the rest", async () => {
    const bad = { ...base, id: "fnd_bad", severity: "urgent" } as unknown as Finding;
    const r = await detect(seededWorkspace, exec, [adapter("fake", [bad, base])]);
    expect(r.findings).toEqual([base]);
    expect(r.failures[0]!.message).toContain("invalid Finding");
  });

  it("installs the target's dependencies once, and reports a failed step instead of failing the scan", async () => {
    let calls = 0;
    const install = async () => {
      calls++;
      return {
        cached: false,
        skipped: [],
        steps: [
          { ecosystem: "npm" as const, phase: "download" as const, command: "npm ci", ok: true, exitCode: 0, timedOut: false, durationMs: 1, output: "" },
          { ecosystem: "pip" as const, phase: "download" as const, command: "pip download", ok: false, exitCode: 1, timedOut: false, durationMs: 1, output: "ERROR: No matching distribution found for nothing==1" },
        ],
      };
    };
    const r = await detect(seededWorkspace, exec, [adapter("fake", [base])], { install });
    expect(calls).toBe(1);
    expect(r.findings).toEqual([base]);
    expect(r.install?.steps).toHaveLength(2);
    expect(r.failures).toEqual([
      { detectorId: "dependency-install", message: "pip download failed (exit 1): ERROR: No matching distribution found for nothing==1" },
    ]);
  });

  it("reports an install that couldn't run at all, and skips it when told to", async () => {
    const broken = async () => {
      throw new Error("could not create the install network");
    };
    const r = await detect(seededWorkspace, exec, [adapter("fake", [base])], { install: broken });
    expect(r.failures).toEqual([{ detectorId: "dependency-install", message: "could not create the install network" }]);
    const skipped = await detect(seededWorkspace, exec, [adapter("fake", [base])], { install: null });
    expect(skipped.install).toBeUndefined();
  });

  it("doesn't try to install without a real sandbox", async () => {
    const r = await detect(seededWorkspace, exec, [adapter("fake", [base])]);
    expect(r.install).toBeUndefined();
    expect(r.failures).toEqual([]);
  });
});
