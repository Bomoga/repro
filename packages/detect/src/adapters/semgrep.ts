import { type DetectorAdapter, type Executor, type Finding, type Severity, type Workspace } from "@repro/contracts";
import { DetectorError, findingId, readEvidence, shq } from "../util.ts";

// In-image rule location (sandbox/Dockerfile, build/prepare-rules.py): /opt/repro/rules/<pack>.
const RULES_ROOT = "/opt/repro/rules";

// The subset of Semgrep's JSON output this adapter reads.
interface SemgrepResult {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message: string;
    severity: string;
    metadata?: { category?: string };
  };
}

interface SemgrepReport {
  results: SemgrepResult[];
  errors: Array<{ level?: string; message?: string }>;
}

// Semgrep's own severities, mapped one-to-one onto the contract's scale. No per-finding judgment:
// that's Diagnose's job.
const SEVERITY: Record<string, Severity> = {
  CRITICAL: "critical",
  ERROR: "high",
  HIGH: "high",
  WARNING: "medium",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
};

// Semgrep's rule-metadata categories onto the contract's named ones; anything else passes
// through unchanged (Finding.category is open-ended), e.g. "privacy".
const CATEGORY: Record<string, string> = {
  security: "vulnerability",
  correctness: "correctness",
  performance: "inefficiency",
  "best-practice": "style",
  maintainability: "style",
  style: "style",
};

export function semgrepScanCommand(pack: string): string {
  return [
    "semgrep scan",
    `--config ${shq(`${RULES_ROOT}/${pack}`)}`,
    "--json --quiet --metrics=off --disable-version-check",
    // The target repo is untrusted (section 9): its nosemgrep comments and .semgrepignore files
    // don't get to hide findings from the scan that's judging it.
    "--disable-nosem --x-ignore-semgrepignore-files",
    "--timeout 30 --max-target-bytes 2000000",
    ".",
  ].join(" ");
}

// Semgrep prefixes a rule's id with the dotted directory of the config file it came from
// ("opt.repro.rules.registry." for /opt/repro/rules/registry/registry.yml). Strip it so ruleId is
// the rule's own id, the one repro-semgrep-rule looks up.
export function stripRulePrefix(checkId: string, pack: string): string {
  const prefix = `${RULES_ROOT}/${pack}`.replace(/^\/+/, "").split("/").join(".") + ".";
  return checkId.startsWith(prefix) ? checkId.slice(prefix.length) : checkId;
}

export function parseSemgrepReport(
  stdout: string,
  workspace: Workspace,
  detectorId: string,
  pack: string,
  createdAt = new Date().toISOString(),
): Finding[] {
  let report: SemgrepReport;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new DetectorError(`semgrep produced an unreadable report: ${stdout.slice(0, 500)}`);
  }
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const r of report.results) {
    const ruleId = stripRulePrefix(r.check_id, pack);
    const file = r.path.replace(/^\.\//, "");
    const id = findingId({
      runId: workspace.runId,
      detectorId,
      ruleId,
      file,
      span: `${r.start.line}:${r.start.col}-${r.end.line}:${r.end.col}`,
    });
    if (seen.has(id)) continue;
    seen.add(id);

    const rawCategory = r.extra.metadata?.category;
    findings.push({
      id,
      detectorId,
      ruleId,
      severity: SEVERITY[r.extra.severity.toUpperCase()] ?? "info",
      category: rawCategory ? (CATEGORY[rawCategory] ?? rawCategory) : "uncategorized",
      file,
      lineStart: r.start.line,
      lineEnd: r.end.line,
      message: r.extra.message.replace(/\s+/g, " ").trim(),
      // Semgrep's own `extra.lines` reads "requires login" without a Semgrep account, so the
      // evidence comes straight from the workspace file instead.
      evidence: readEvidence(workspace.path, file, r.start.line, r.end.line),
      reproducible: false,
      reproductionCommand: `repro-semgrep-rule ${shq(pack)} ${shq(ruleId)} ${shq(file)}`,
      createdAt,
    });
  }
  return findings;
}

// One adapter per rule pack. "semgrep" runs the Semgrep registry's JS/TS and Python packs;
// "privacy-patterns" runs Repro's own pack (sandbox/rules/privacy-patterns) for the Assurant
// challenge. Same tool, separate detectorIds, so Diagnose and the Trust Report can tell them apart.
export function createSemgrepAdapter(detectorId: string, pack: string): DetectorAdapter {
  return {
    id: detectorId,
    async run(workspace: Workspace, exec: Executor): Promise<Finding[]> {
      const result = await exec.exec({
        workspacePath: workspace.path,
        command: semgrepScanCommand(pack),
        timeoutMs: 15 * 60_000,
      });
      // Without --error, semgrep exits 0 whether or not it found anything; non-zero means the
      // scan itself failed.
      if (result.timedOut || result.exitCode !== 0) {
        throw new DetectorError(
          `semgrep (${pack}) failed (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}): ${result.stderr.slice(0, 2000)}`,
        );
      }
      return parseSemgrepReport(result.stdout, workspace, detectorId, pack);
    },
  };
}

export const semgrepAdapter = createSemgrepAdapter("semgrep", "registry");
