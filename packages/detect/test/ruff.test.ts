import { Finding } from "@repro/contracts";
import { describe, expect, it } from "vitest";
import { RUFF_SCAN_COMMAND, parseRuffReport, ruffAdapter } from "../src/adapters/ruff.ts";
import { DetectorError } from "../src/util.ts";
import { FakeExecutor, fixture, seededWorkspace } from "./helpers.ts";

describe("ruff adapter", () => {
  it("maps Bandit's S rules to vulnerabilities and bugbear's B rules to correctness", () => {
    const findings = parseRuffReport(fixture("ruff.json"), seededWorkspace);
    expect(findings.map((f) => [f.ruleId, f.file, f.lineStart, f.category, f.severity])).toEqual([
      ["S602", "app/jobs.py", 5, "vulnerability", "medium"],
      ["B006", "app/jobs.py", 8, "correctness", "low"],
    ]);
    for (const f of findings) {
      Finding.parse(f);
      expect(f).toMatchObject({ detectorId: "ruff", reproducible: false });
      expect(f.reproductionCommand).toBe(`repro-ruff-rule '${f.ruleId}' 'app/jobs.py'`);
    }
    expect(findings[1]!.evidence).toBe("def queue(job, pending=[]):");
  });

  it("runs isolated from the target's own config and noqa comments", async () => {
    expect(RUFF_SCAN_COMMAND).toContain("--select S,B");
    expect(RUFF_SCAN_COMMAND).toContain("--isolated");
    expect(RUFF_SCAN_COMMAND).toContain("--ignore-noqa");
    const exec = new FakeExecutor(() => ({ stdout: fixture("ruff.json") }));
    expect(await ruffAdapter.run(seededWorkspace, exec)).toHaveLength(2);
    expect(exec.requests[0]!.command).toBe(RUFF_SCAN_COMMAND);
  });

  it("skips projects with no Python, and treats a failed scan as an error", async () => {
    const exec = new FakeExecutor(() => ({ stdout: "[]" }));
    expect(await ruffAdapter.run({ ...seededWorkspace, languages: ["javascript"] }, exec)).toEqual([]);
    expect(exec.requests).toHaveLength(0);
    const broken = new FakeExecutor(() => ({ exitCode: 2, stderr: "ruff: error" }));
    await expect(ruffAdapter.run(seededWorkspace, broken)).rejects.toBeInstanceOf(DetectorError);
  });
});
