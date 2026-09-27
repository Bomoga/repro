import { type DetectorAdapter, type Executor, type Finding, type Workspace } from "@repro/contracts";
import { DetectorError, findingId, readEvidence, redactSecrets, shq } from "../util.ts";

// One entry per failing test, as printed by `repro-test scan` (sandbox/bin/repro-test).
export interface FailingTest {
  kind: "node" | "unittest" | "pytest" | "suite";
  /** What `repro-test check` re-runs: the test name, unittest id, pytest node id, or command. */
  id: string;
  name: string;
  file: string;
  line: number;
  message: string;
  /** unittest's top-level directory, which its ids are relative to. */
  top?: string;
}

// A failing test is a correctness defect by definition. It has no tool-assigned severity, so every
// one gets the same, the same way every gitleaks leak does.
const SEVERITY = "medium";

export function parseFailingTests(stdout: string, workspace: Workspace, createdAt = new Date().toISOString()): Finding[] {
  let failures: FailingTest[];
  try {
    failures = JSON.parse(stdout);
  } catch {
    throw new DetectorError(`repro-test produced an unreadable report: ${stdout.slice(0, 500)}`);
  }
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const test of failures) {
    const ruleId = `${test.kind}:${test.id}`;
    const id = findingId({ runId: workspace.runId, detectorId: "tests", ruleId, file: test.file, span: `${test.line}` });
    if (seen.has(id)) continue;
    seen.add(id);
    const args = [test.kind, test.file, String(test.line), test.id, ...(test.top ? [test.top] : [])];
    findings.push({
      id,
      detectorId: "tests",
      ruleId,
      severity: SEVERITY,
      category: "correctness",
      file: test.file,
      lineStart: test.line,
      lineEnd: test.line,
      message: redactSecrets(
        test.kind === "suite"
          ? `The project's test command \`${test.id}\` fails: ${test.message}`
          : `Test "${test.name}" fails${test.message ? `: ${test.message}` : ""}`,
      ),
      evidence: readEvidence(workspace.path, test.file, test.line, test.line),
      reproducible: false,
      reproductionCommand: `repro-test check ${args.map(shq).join(" ")}`,
      createdAt,
    });
  }
  return findings;
}

// The project's own test suite, run in the sandbox after its dependencies are installed: each
// failing test is a Finding, and re-running that one test is its reproduction. The most grounded
// Finding Repro has, since the project's own authors wrote down what correct means.
export const testsAdapter: DetectorAdapter = {
  id: "tests",
  async run(workspace: Workspace, exec: Executor): Promise<Finding[]> {
    const result = await exec.exec({ workspacePath: workspace.path, command: "repro-test scan", timeoutMs: 20 * 60_000 });
    if (result.timedOut || result.exitCode !== 0) {
      throw new DetectorError(
        `the test suite couldn't be run (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}): ${result.stderr.slice(0, 2000)}`,
      );
    }
    return parseFailingTests(result.stdout, workspace);
  },
};
