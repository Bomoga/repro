import { type DetectorAdapter, type Executor, type Finding, type Severity, type Workspace } from "@repro/contracts";
import { DetectorError, findingId, readEvidence, shq } from "../util.ts";

// The Ruff rule families Repro runs: Bandit's security checks (S) and flake8-bugbear's likely
// bugs (B), such as mutable default arguments.
export const RUFF_SELECT = ["S", "B"] as const;

// Ruff's own "severity" is a diagnostic level (every one is "error"), not risk, so the mapping is
// per rule family: the same for every Finding in it, like gitleaks'.
const BY_FAMILY: Record<(typeof RUFF_SELECT)[number], { category: string; severity: Severity }> = {
  S: { category: "vulnerability", severity: "medium" },
  B: { category: "correctness", severity: "low" },
};

// Bandit's S101 ("assert used") is left out: it flags every assert in every pytest test, which would
// bury the rest in Findings that all reproduce.
export const RUFF_IGNORE = ["S101"] as const;

// Runs --isolated (the target's own ruff.toml/pyproject can't turn rules off) and --ignore-noqa
// (its `# noqa` comments can't hide them), the same stance as Semgrep's --disable-nosem.
export const RUFF_SCAN_COMMAND = [
  "ruff check",
  `--select ${RUFF_SELECT.join(",")} --ignore ${RUFF_IGNORE.join(",")}`,
  "--output-format json --isolated --no-cache --ignore-noqa --exit-zero",
  "--extend-exclude .repro",
  ".",
].join(" ");

// The subset of Ruff's JSON output this adapter reads.
interface RuffResult {
  code: string;
  message: string;
  filename: string;
  location: { row: number; column: number };
  end_location: { row: number; column: number };
}

const CONTAINER_ROOT = "/workspace/";

export function parseRuffReport(stdout: string, workspace: Workspace, createdAt = new Date().toISOString()): Finding[] {
  let results: RuffResult[];
  try {
    results = JSON.parse(stdout);
  } catch {
    throw new DetectorError(`ruff produced an unreadable report: ${stdout.slice(0, 500)}`);
  }
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const r of results) {
    const family = BY_FAMILY[r.code.charAt(0) as keyof typeof BY_FAMILY];
    if (!family) continue;
    const file = r.filename.startsWith(CONTAINER_ROOT) ? r.filename.slice(CONTAINER_ROOT.length) : r.filename.replace(/^\.\//, "");
    const id = findingId({
      runId: workspace.runId,
      detectorId: "ruff",
      ruleId: r.code,
      file,
      span: `${r.location.row}:${r.location.column}-${r.end_location.row}:${r.end_location.column}`,
    });
    if (seen.has(id)) continue;
    seen.add(id);
    findings.push({
      id,
      detectorId: "ruff",
      ruleId: r.code,
      severity: family.severity,
      category: family.category,
      file,
      lineStart: r.location.row,
      lineEnd: r.end_location.row,
      message: r.message.replace(/\s+/g, " ").trim(),
      evidence: readEvidence(workspace.path, file, r.location.row, r.end_location.row),
      reproducible: false,
      reproductionCommand: `repro-ruff-rule ${shq(r.code)} ${shq(file)}`,
      createdAt,
    });
  }
  return findings;
}

// Ruff's security (S) and bugbear (B) rules over the project's Python code: a second, faster
// opinion alongside Semgrep's Python packs, with its own reproduction per rule and file.
export const ruffAdapter: DetectorAdapter = {
  id: "ruff",
  async run(workspace: Workspace, exec: Executor): Promise<Finding[]> {
    if (!workspace.languages.includes("python")) return [];
    const result = await exec.exec({ workspacePath: workspace.path, command: RUFF_SCAN_COMMAND, timeoutMs: 10 * 60_000 });
    if (result.timedOut || result.exitCode !== 0) {
      throw new DetectorError(
        `ruff failed (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}): ${result.stderr.slice(0, 2000)}`,
      );
    }
    return parseRuffReport(result.stdout, workspace);
  },
};
