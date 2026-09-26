import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Finding } from "@repro/contracts";
import { describe, expect, it } from "vitest";
import { gitleaksAdapter, parseGitleaksReport } from "../src/adapters/gitleaks.ts";
import { DetectorError } from "../src/util.ts";
import { FakeExecutor, SEEDED, fixture, seededWorkspace } from "./helpers.ts";

const seededKey = /api_key: "([0-9a-f]{40})"/.exec(readFileSync(join(SEEDED, "server/config.js"), "utf8"))![1]!;

describe("gitleaks adapter", () => {
  it("runs gitleaks redacted, with Repro's own config and ignore path", async () => {
    const exec = new FakeExecutor(() => ({ stdout: fixture("gitleaks.json") }));
    await gitleaksAdapter.run(seededWorkspace, exec);
    const cmd = exec.requests[0]!.command;
    expect(cmd).toContain("--redact");
    expect(cmd).toContain("--config /opt/repro/gitleaks/gitleaks.toml");
    expect(cmd).toContain("--gitleaks-ignore-path /opt/repro/gitleaks/no-ignore");
  });

  it("translates the report into unconfirmed Findings that never contain the secret", () => {
    const findings = parseGitleaksReport(fixture("gitleaks.json"), seededWorkspace);
    expect(findings).toHaveLength(1);
    const f = Finding.parse(findings[0]);
    expect(f).toMatchObject({
      detectorId: "gitleaks",
      ruleId: "generic-api-key",
      file: "server/config.js",
      lineStart: 4,
      reproducible: false,
      reproductionCommand: "repro-gitleaks-rule 'generic-api-key' 'server/config.js'",
    });
    expect(f.reproductionOutput).toBeUndefined();
    expect(JSON.stringify(f)).not.toContain(seededKey);
    expect(f.evidence).toContain("REDACTED");
  });

  it("scrubs a secret even if gitleaks failed to redact it", () => {
    const leaky = JSON.parse(fixture("gitleaks.json"));
    leaky[0].Secret = seededKey;
    leaky[0].Match = `api_key: "${seededKey}"`;
    const [f] = parseGitleaksReport(JSON.stringify(leaky), seededWorkspace);
    expect(JSON.stringify(f)).not.toContain(seededKey);
  });

  it("treats a failed scan as an error, not as zero findings", async () => {
    const exec = new FakeExecutor(() => ({ exitCode: 1, stderr: "boom" }));
    await expect(gitleaksAdapter.run(seededWorkspace, exec)).rejects.toBeInstanceOf(DetectorError);
  });
});
