import { type DetectorAdapter, type Executor, type Finding, type Workspace } from "@repro/contracts";
import { DetectorError, findingId, redactSecrets, shq } from "../util.ts";

// In-image paths (sandbox/Dockerfile).
const CONFIG = "/opt/repro/gitleaks/gitleaks.toml";
const IGNORE_DIR = "/opt/repro/gitleaks/no-ignore";
const REPORT = "/tmp/gitleaks-report.json";

// The subset of gitleaks' JSON report this adapter reads.
interface GitleaksLeak {
  RuleID: string;
  Description: string;
  StartLine: number;
  EndLine: number;
  StartColumn: number;
  EndColumn: number;
  Match: string;
  Secret: string;
  File: string;
}

// Scans the working tree at headCommit (`gitleaks dir`, not git history: a Finding has to point
// at a file in this Workspace). Always --redact, and always Repro's own config and ignore path,
// so a target's .gitleaks.toml or .gitleaksignore can't allowlist its own leaks.
export const GITLEAKS_SCAN_COMMAND = [
  "gitleaks dir .",
  "--redact --no-banner --log-level error",
  `--config ${CONFIG}`,
  `--gitleaks-ignore-path ${IGNORE_DIR}`,
  `--report-format json --report-path ${REPORT}`,
  "--exit-code 0",
  `&& cat ${REPORT}`,
].join(" ");

// A secret sitting in source has no tool-assigned severity. Every gitleaks Finding gets the same
// one, so this is a mapping, not a per-finding judgment.
const SEVERITY = "high";

export function parseGitleaksReport(report: string, workspace: Workspace, createdAt = new Date().toISOString()): Finding[] {
  let leaks: GitleaksLeak[];
  try {
    leaks = JSON.parse(report) ?? [];
  } catch {
    throw new DetectorError(`gitleaks produced an unreadable report: ${report.slice(0, 500)}`);
  }
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const leak of leaks) {
    const file = leak.File.replace(/^\.\//, "");
    const id = findingId({
      runId: workspace.runId,
      detectorId: "gitleaks",
      ruleId: leak.RuleID,
      file,
      span: `${leak.StartLine}:${leak.StartColumn}-${leak.EndLine}:${leak.EndColumn}`,
    });
    if (seen.has(id)) continue;
    seen.add(id);

    // --redact already replaced the secret with REDACTED. If it ever didn't, scrub the raw
    // value out of Match here rather than trust that it did.
    let evidence = leak.Match;
    if (leak.Secret && leak.Secret !== "REDACTED") evidence = evidence.replaceAll(leak.Secret, "REDACTED");

    findings.push({
      id,
      detectorId: "gitleaks",
      ruleId: leak.RuleID,
      severity: SEVERITY,
      category: "vulnerability",
      file,
      lineStart: leak.StartLine,
      lineEnd: leak.EndLine,
      message: leak.Description,
      evidence: redactSecrets(evidence),
      reproducible: false,
      reproductionCommand: `repro-gitleaks-rule ${shq(leak.RuleID)} ${shq(file)}`,
      createdAt,
    });
  }
  return findings;
}

export const gitleaksAdapter: DetectorAdapter = {
  id: "gitleaks",
  async run(workspace: Workspace, exec: Executor): Promise<Finding[]> {
    const result = await exec.exec({ workspacePath: workspace.path, command: GITLEAKS_SCAN_COMMAND, timeoutMs: 10 * 60_000 });
    // With --exit-code 0, gitleaks exits non-zero only when the scan itself failed.
    if (result.timedOut || result.exitCode !== 0) {
      throw new DetectorError(
        `gitleaks failed (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}): ${result.stderr.slice(0, 2000)}`,
      );
    }
    return parseGitleaksReport(result.stdout, workspace);
  },
};
