import type { DetectorAdapter, Executor, Finding, Workspace } from "../contracts.js";

/**
 * Findings the patch introduced: detectors re-run on the patched tree, keeping only findings
 * in changed files that weren't there before. Findings of the same rule in the same file as a
 * cited Finding are left to the reproduction re-run, which decides whether the original issue
 * is still there. Returned Findings are exactly what the adapters emitted, unmodified.
 */
export async function findRegressions(args: {
  detectors: DetectorAdapter[];
  workspace: Workspace;
  executor: Executor;
  baseline: Finding[];
  cited: Finding[];
  changedFiles: string[];
}): Promise<Finding[]> {
  const changed = new Set(args.changedFiles.map(normalizePath));
  if (changed.size === 0) return [];
  const before = new Set(args.baseline.map(fingerprint));
  const citedRules = new Set(args.cited.map(ruleKey));
  const regressions: Finding[] = [];
  // Sequential: adapters share one Executor and one workspace.
  for (const detector of args.detectors) {
    for (const finding of await detector.run(args.workspace, args.executor)) {
      if (!changed.has(normalizePath(finding.file))) continue;
      if (before.has(fingerprint(finding)) || citedRules.has(ruleKey(finding))) continue;
      regressions.push(finding);
    }
  }
  return regressions;
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

function ruleKey(finding: Finding): string {
  return [finding.detectorId, finding.ruleId, normalizePath(finding.file)].join("\u0000");
}

/** Line numbers shift when a patch lands, so identity is detector, rule, file, and evidence. */
function fingerprint(finding: Finding): string {
  return [ruleKey(finding), finding.evidence.replace(/\s+/g, " ").trim()].join("\u0000");
}
