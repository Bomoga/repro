import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Finding, type Workspace } from "@repro/contracts";
import { DockerExecutor, sandboxAvailable } from "@repro/executor";
import { ingest, removeWorkspace } from "@repro/ingest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detect } from "../src/engine.ts";
import { reproduce } from "../src/reproduce.ts";
import { SEEDED } from "./helpers.ts";

// Full lane 2 path against the real sandbox image: ingest -> detect -> reproduce. Skipped when
// repro-sandbox:dev isn't built (npm run sandbox:build).
const ready = await sandboxAvailable();

describe.skipIf(!ready)("lane 2 end to end (sandbox)", () => {
  const exec = new DockerExecutor();
  const seededKey = /api_key: "([0-9a-f]{40})"/.exec(readFileSync(join(SEEDED, "server/config.js"), "utf8"))![1]!;
  let source: string;
  let workspace: Workspace;
  let findings: Finding[];

  beforeAll(async () => {
    source = mkdtempSync(join(tmpdir(), "repro-seeded-"));
    cpSync(SEEDED, source, { recursive: true });
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: source });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "seed");
    workspace = await ingest(`e2e-${Date.now()}`, { kind: "local", ref: source });
  }, 60_000);

  afterAll(() => {
    if (workspace) removeWorkspace(workspace);
    rmSync(source, { recursive: true, force: true });
  });

  it("detects every seeded issue, all unconfirmed", async () => {
    const result = await detect(workspace, exec);
    expect(result.failures).toEqual([]);
    findings = result.findings;
    const byDetector = (id: string) => findings.filter((f) => f.detectorId === id).length;
    expect(byDetector("semgrep")).toBe(4);
    expect(byDetector("gitleaks")).toBe(1);
    expect(byDetector("privacy-patterns")).toBe(7);
    // Advisory counts depend on the image's OSV snapshot, so pin the two seeded ones, not a total.
    expect(findings.filter((f) => f.detectorId === "osv-scanner").map((f) => `${f.file}:${f.ruleId}`)).toEqual(
      expect.arrayContaining(["package-lock.json:GHSA-xvch-5gv4-984h", "requirements.txt:GHSA-8q59-q68h-6hv4"]),
    );
    expect(findings.every((f) => f.reproducible === false && f.reproductionOutput === undefined)).toBe(true);
  }, 300_000);

  it("reproduces each one through the sandbox, and only then marks it reproducible", async () => {
    const { findings: confirmed, attempts } = await reproduce(findings, workspace, exec);
    expect(attempts.map((a) => a.outcome)).toEqual(findings.map(() => "reproduced"));
    for (const f of confirmed) {
      expect(f.reproducible).toBe(true);
      expect(f.reproductionOutput).toMatch(new RegExp(`^REPRODUCED \\S+ .* at ${f.file}:${f.lineStart}-`));
    }
    findings = confirmed;
  }, 300_000);

  it("never lets the seeded secret out of lane 2", () => {
    expect(JSON.stringify(findings)).not.toContain(seededKey);
    const leak = findings.find((f) => f.detectorId === "gitleaks")!;
    expect(leak.evidence).toContain("REDACTED");
    expect(leak.reproductionOutput).toContain("REDACTED");
  });

  it("reports a dependency advisory fixed once the pin is upgraded", async () => {
    const pyyaml = findings.find((f) => f.ruleId === "GHSA-8q59-q68h-6hv4")!;
    expect(pyyaml.reproductionOutput).toContain("osv database snapshot:");
    const file = join(workspace.path, pyyaml.file);
    const before = readFileSync(file, "utf8");
    writeFileSync(file, before.replace("PyYAML==5.3.1", "PyYAML==5.4"));
    try {
      const after = await exec.exec({ workspacePath: workspace.path, command: pyyaml.reproductionCommand!, timeoutMs: 120_000 });
      expect(after.exitCode).toBe(0);
      expect(after.stdout).toContain("NOT REPRODUCED");
    } finally {
      writeFileSync(file, before);
    }
  }, 120_000);

  it("gives Repair a reproductionCommand that reports the fix once the code changes", async () => {
    const shell = findings.find((f) => f.ruleId.endsWith("subprocess-shell-true"))!;
    const file = join(workspace.path, shell.file);
    const before = readFileSync(file, "utf8");
    writeFileSync(file, before.replace('subprocess.call("ping -c 1 " + host, shell=True)', 'subprocess.call(["ping", "-c", "1", host])'));
    try {
      const after = await exec.exec({ workspacePath: workspace.path, command: shell.reproductionCommand!, timeoutMs: 120_000 });
      expect(after.exitCode).toBe(0);
      expect(after.stdout).toContain("NOT REPRODUCED");
    } finally {
      writeFileSync(file, before);
    }
  }, 120_000);
});
