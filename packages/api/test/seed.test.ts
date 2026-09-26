import { describe, expect, it } from "vitest";
import { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import { demoRunRecords, seedDemoData } from "../src/seed.ts";
import { InMemoryRunStore, meetsVerificationGate } from "../src/store/index.ts";

const now = new Date("2026-09-26T12:00:00.000Z");
const records = demoRunRecords(now);
const byId = (id: string) => records.find((r) => r.run.id === id)!;

/** Every hunk's header line counts have to match its body, or `git apply` refuses the diff. */
function hunkProblems(diff: string): string[] {
  const problems: string[] = [];
  const lines = diff.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(lines[i]!);
    if (!header) continue;
    const expectedOld = Number(header[1] ?? 1);
    const expectedNew = Number(header[2] ?? 1);
    let oldCount = 0;
    let newCount = 0;
    for (let j = i + 1; j < lines.length && /^[ +-]/.test(lines[j]!) && !lines[j]!.startsWith("--- "); j++) {
      if (lines[j]!.startsWith("+")) newCount++;
      else if (lines[j]!.startsWith("-")) oldCount++;
      else {
        oldCount++;
        newCount++;
      }
    }
    if (oldCount !== expectedOld || newCount !== expectedNew) {
      problems.push(`${lines[i]} has ${oldCount} old / ${newCount} new lines`);
    }
  }
  return problems;
}

describe("demo seed data", () => {
  it("is made of valid section 4 contract objects", () => {
    for (const record of records) {
      expect(Run.parse(record.run)).toEqual(record.run);
      for (const finding of record.findings) expect(Finding.parse(finding)).toEqual(finding);
      for (const diagnosis of record.diagnoses) expect(Diagnosis.parse(diagnosis)).toEqual(diagnosis);
      for (const patch of record.patches) expect(Patch.parse(patch)).toEqual(patch);
    }
  });

  it("can't pass for real scans", () => {
    for (const record of records) {
      expect(record.run.id).toMatch(/^run_demo_/);
      expect(record.run.target.ref).toMatch(/^\/demo\//);
      for (const item of [...record.findings, ...record.diagnoses, ...record.patches]) expect(item.id).toContain("_demo_");
    }
  });

  it("follows section 4's reproduction semantics", () => {
    for (const finding of records.flatMap((r) => r.findings)) {
      if (!finding.reproducible) {
        expect(finding.reproductionOutput, finding.id).toBeUndefined();
        continue;
      }
      // Lane 2's protocol: the output that flipped it names this Finding's own file and start line.
      expect(finding.reproductionCommand, finding.id).toBeTruthy();
      expect(finding.reproductionOutput, finding.id).toContain(`REPRODUCED ${finding.detectorId === "gitleaks" ? "gitleaks" : "semgrep"}`);
      expect(finding.reproductionOutput, finding.id).toContain(` at ${finding.file}:${finding.lineStart}-`);
    }
  });

  it("only repairs Diagnoses whose cited Findings all reproduce", () => {
    for (const record of records) {
      const findings = new Map(record.findings.map((f) => [f.id, f]));
      for (const patch of record.patches) {
        const diagnosis = record.diagnoses.find((d) => d.id === patch.diagnosisId)!;
        for (const id of diagnosis.findingIds) expect(findings.get(id)?.reproducible, `${patch.id} -> ${id}`).toBe(true);
      }
    }
  });

  it("marks a Patch verified only when it carries the gate's proof", () => {
    for (const patch of records.flatMap((r) => r.patches)) {
      if (patch.status === "verified" || patch.status === "merged") expect(meetsVerificationGate(patch), patch.id).toBe(true);
    }
  });

  it("keeps every secret out of the store", () => {
    const text = JSON.stringify(records);
    expect(text).not.toMatch(/sk-[A-Za-z0-9-]{16,}/);
    const leaks = records.flatMap((r) => r.findings).filter((f) => f.detectorId === "gitleaks");
    expect(leaks.length).toBeGreaterThan(0);
    for (const leak of leaks) expect(leak.evidence).toContain("REDACTED");
  });

  it("names the exact Gemini model on every Diagnosis", () => {
    for (const diagnosis of records.flatMap((r) => r.diagnoses)) expect(diagnosis.model).toMatch(/^gemini-\d/);
  });

  it("carries unified diffs whose hunks add up", () => {
    for (const patch of records.flatMap((r) => r.patches)) {
      expect(patch.diff.startsWith(`diff --git a/${patch.filesChanged[0]} b/${patch.filesChanged[0]}\n`), patch.id).toBe(true);
      expect(hunkProblems(patch.diff), patch.id).toEqual([]);
    }
  });

  it("covers the section 8 demo beats", () => {
    const completed = byId("run_demo_completed");
    // Beat 2: the count collapses from everything flagged to what reproduced.
    expect(completed.findings).toHaveLength(6);
    expect(completed.findings.filter((f) => f.reproducible)).toHaveLength(4);
    // Beat 3: one Diagnosis grouping several Findings under one root cause.
    expect(completed.diagnoses.some((d) => d.findingIds.length >= 2)).toBe(true);
    // Beat 5: the Challenger disputes a first fix and confirms the retry for the same Diagnosis.
    const sqli = completed.patches.filter((p) => p.diagnosisId === "diag_demo_sqli");
    expect(sqli.map((p) => [p.challengerVerdict, p.status])).toEqual([
      ["disputed", "rejected"],
      ["confirmed", "verified"],
    ]);
    // A fix rejected for introducing a new Finding.
    expect(completed.patches.some((p) => p.status === "rejected" && p.regressionFindings.length > 0)).toBe(true);
    // Runs in every other state the status surface shows.
    expect(records.map((r) => [r.run.stage, r.run.status])).toEqual([
      ["done", "completed"],
      ["repair", "running"],
      ["ingest", "queued"],
      ["ingest", "failed"],
    ]);
  });

  it("seeds through the store's writes, idempotently", async () => {
    const store = new InMemoryRunStore();
    const first = await seedDemoData(store, { now });
    expect(first).toEqual({ seeded: records.map((r) => r.run.id), skipped: [] });
    const again = await seedDemoData(store, { now });
    expect(again).toEqual({ seeded: [], skipped: first.seeded });

    expect(await store.countRuns(["run_demo_completed"])).toEqual({
      run_demo_completed: { findings: 6, reproducible: 4, diagnoses: 3, patches: 5, verifiedPatches: 3 },
    });
    expect(await store.listPatches("run_demo_completed")).toEqual(byId("run_demo_completed").patches);
  });

  it("dates the runs relative to now, newest first as listed", async () => {
    const store = new InMemoryRunStore();
    await seedDemoData(store, { now });
    const runs = await store.listRuns();
    expect(runs.map((r) => r.id)).toEqual(["run_demo_queued", "run_demo_repairing", "run_demo_completed", "run_demo_failed"]);
    for (const run of runs) expect(Date.parse(run.startedAt)).toBeLessThanOrEqual(now.getTime());
  });
});
