import { Finding } from "@repro/contracts";
import { describe, expect, it } from "vitest";
import { lockfilesIn, osvAdapter, parseOsvHits } from "../src/adapters/osv.ts";
import { DetectorError } from "../src/util.ts";
import { FakeExecutor, fixture, seededWorkspace } from "./helpers.ts";

describe("lockfilesIn", () => {
  it("picks npm and PyPI lockfiles out of the file index, and nothing else", () => {
    expect(
      lockfilesIn([
        "package-lock.json",
        "web/yarn.lock",
        "api/poetry.lock",
        "requirements.txt",
        "requirements-dev.txt",
        "deploy/prod.requirements.txt",
        "package.json",
        "README.md",
        "node_modules/left-pad/package-lock.json",
        "weird:name/requirements.txt",
      ]),
    ).toEqual(["package-lock.json", "web/yarn.lock", "api/poetry.lock", "requirements.txt", "requirements-dev.txt", "deploy/prod.requirements.txt"]);
  });
});

describe("osv-scanner adapter", () => {
  it("doesn't run anything when the workspace has no lockfiles", async () => {
    const exec = new FakeExecutor(() => ({ stdout: "[]" }));
    const findings = await osvAdapter.run({ ...seededWorkspace, fileIndex: ["app/jobs.py"] }, exec);
    expect(findings).toEqual([]);
    expect(exec.requests).toHaveLength(0);
  });

  it("scans exactly the indexed lockfiles, quoted", async () => {
    const exec = new FakeExecutor(() => ({ stdout: fixture("osv.json") }));
    await osvAdapter.run(seededWorkspace, exec);
    expect(exec.requests[0]!.command).toBe("repro-osv scan 'package-lock.json' 'requirements.txt'");
  });

  it("turns each advisory into one unconfirmed vulnerability Finding on the pinning line", () => {
    const findings = parseOsvHits(fixture("osv.json"), seededWorkspace);
    expect(findings.map((f) => [f.ruleId, f.file, f.lineStart, f.lineEnd, f.severity])).toEqual([
      ["GHSA-xvch-5gv4-984h", "package-lock.json", 14, 15, "critical"],
      ["GHSA-8q59-q68h-6hv4", "requirements.txt", 1, 1, "critical"],
    ]);
    for (const f of findings) {
      Finding.parse(f);
      expect(f).toMatchObject({ detectorId: "osv-scanner", category: "vulnerability", reproducible: false });
    }
    const [minimist, pyyaml] = findings;
    expect(minimist!.evidence).toBe('    "node_modules/minimist": {\n      "version": "1.2.5",');
    expect(pyyaml!.evidence).toBe("PyYAML==5.3.1");
    expect(pyyaml!.message).toContain("pyyaml@5.3.1 (PyPI) has a known vulnerability, GHSA-8q59-q68h-6hv4 / CVE-2020-14343");
    expect(pyyaml!.message).toContain("Fixed in 5.4.");
    expect(pyyaml!.reproductionCommand).toBe("repro-osv check 'requirements.txt' 'pyyaml' 'GHSA-8q59-q68h-6hv4'");
  });

  it("falls back to medium for a severity outside the contract's scale", () => {
    const hits = JSON.parse(fixture("osv.json"));
    hits[0].severity = "moderate-ish";
    expect(parseOsvHits(JSON.stringify(hits), seededWorkspace)[0]!.severity).toBe("medium");
  });

  it("treats a failed scan as an error, not as a clean bill of health", async () => {
    const exec = new FakeExecutor(() => ({ exitCode: 2, stderr: "osv-scanner exited 127" }));
    await expect(osvAdapter.run(seededWorkspace, exec)).rejects.toBeInstanceOf(DetectorError);
  });
});
