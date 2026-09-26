import { Finding } from "@repro/contracts";
import { describe, expect, it } from "vitest";
import { parseSemgrepReport, semgrepAdapter, stripRulePrefix } from "../src/adapters/semgrep.ts";
import { FakeExecutor, fixture, seededWorkspace } from "./helpers.ts";

describe("semgrep adapter", () => {
  it("strips the in-image config prefix from rule ids", () => {
    expect(stripRulePrefix("opt.repro.rules.registry.python.lang.x.y", "registry")).toBe("python.lang.x.y");
    expect(stripRulePrefix("opt.repro.rules.privacy-patterns.privacy.prompt-logging.js", "privacy-patterns")).toBe(
      "privacy.prompt-logging.js",
    );
  });

  it("translates registry results without filtering or re-ranking them", () => {
    const findings = parseSemgrepReport(fixture("semgrep-registry.json"), seededWorkspace, "semgrep", "registry");
    expect(findings.map((f) => [f.ruleId.split(".").at(-1), f.file, f.lineStart, f.severity, f.category])).toEqual([
      ["subprocess-shell-true", "app/jobs.py", 5, "high", "vulnerability"],
      ["raw-html-format", "server/index.js", 6, "medium", "vulnerability"],
      ["direct-response-write", "server/index.js", 6, "medium", "vulnerability"],
      ["code-string-concat", "server/index.js", 10, "high", "vulnerability"],
    ]);
    for (const f of findings) {
      Finding.parse(f);
      expect(f.reproducible).toBe(false);
      expect(f.reproductionCommand).toBe(`repro-semgrep-rule 'registry' '${f.ruleId}' '${f.file}'`);
    }
  });

  it("takes evidence from the workspace file, since semgrep's own says 'requires login'", () => {
    const [shell] = parseSemgrepReport(fixture("semgrep-registry.json"), seededWorkspace, "semgrep", "registry");
    expect(shell!.evidence).toBe('    return subprocess.call("ping -c 1 " + host, shell=True)');
  });

  it("gives every finding a stable, unique id", () => {
    const a = parseSemgrepReport(fixture("semgrep-registry.json"), seededWorkspace, "semgrep", "registry");
    const b = parseSemgrepReport(fixture("semgrep-registry.json"), seededWorkspace, "semgrep", "registry");
    expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id));
    expect(new Set(a.map((f) => f.id)).size).toBe(a.length);
  });

  it("collapses a result semgrep reported twice", () => {
    const report = JSON.parse(fixture("semgrep-registry.json"));
    report.results.push(report.results[0]);
    expect(parseSemgrepReport(JSON.stringify(report), seededWorkspace, "semgrep", "registry")).toHaveLength(4);
  });

  it("runs the registry pack with target-side suppressions disabled", async () => {
    const exec = new FakeExecutor(() => ({ stdout: fixture("semgrep-registry.json") }));
    await semgrepAdapter.run(seededWorkspace, exec);
    const cmd = exec.requests[0]!.command;
    expect(cmd).toContain("--config '/opt/repro/rules/registry'");
    expect(cmd).toContain("--disable-nosem");
    expect(cmd).toContain("--metrics=off");
  });
});
