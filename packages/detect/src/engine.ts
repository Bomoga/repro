import { type DetectorAdapter, type Executor, Finding, type Workspace } from "@repro/contracts";
import { DockerExecutor, type InstallReport, installDependencies } from "@repro/executor";
import { gitleaksAdapter } from "./adapters/gitleaks.ts";
import { osvAdapter } from "./adapters/osv.ts";
import { privacyPatternsAdapter } from "./adapters/privacy-patterns.ts";
import { semgrepAdapter } from "./adapters/semgrep.ts";

export interface DetectorFailure {
  detectorId: string;
  message: string;
}

export interface DetectResult {
  findings: Finding[];
  // An adapter that failed contributes no Findings, and its failure is reported here rather than
  // silently read as "found nothing".
  failures: DetectorFailure[];
  // Findings dropped because they point at a file outside Workspace.fileIndex (e.g. inside .git/),
  // which can't be tied back to headCommit.
  droppedOutsideIndex: number;
  /** What the dependency-install step did, when it ran (see installFor). */
  install?: InstallReport;
}

export interface DetectOptions {
  /** Installs the target's dependencies. Defaults to installFor(exec); pass null to skip. */
  install?: ((workspace: Workspace) => Promise<InstallReport>) | null;
}

// Detectors that run the target's own code, and so need its dependencies installed first. Everything
// else is a static scanner, run before the install so it never walks an installed node_modules/.
const RUNS_TARGET_CODE = new Set<string>();

/** The dependency-install step for this Executor: only a real sandbox can install anything. */
export function installFor(exec: Executor): ((workspace: Workspace) => Promise<InstallReport>) | undefined {
  return exec instanceof DockerExecutor ? (workspace) => installDependencies(workspace, exec.options) : undefined;
}

export function defaultAdapters(): DetectorAdapter[] {
  return [semgrepAdapter, gitleaksAdapter, privacyPatternsAdapter, osvAdapter];
}

// The Deterministic Detection Engine: runs every enabled adapter, nothing else. No model calls,
// and it only ever talks to adapters through the DetectorAdapter interface.
export async function detect(
  workspace: Workspace,
  exec: Executor,
  adapters: DetectorAdapter[] = defaultAdapters(),
  options: DetectOptions = {},
): Promise<DetectResult> {
  const indexed = new Set(workspace.fileIndex);
  const result: DetectResult = { findings: [], failures: [], droppedOutsideIndex: 0 };

  const collect = (adapter: DetectorAdapter, outcome: PromiseSettledResult<Finding[]>) => {
    if (outcome.status === "rejected") {
      result.failures.push({ detectorId: adapter.id, message: String(outcome.reason?.message ?? outcome.reason) });
      return;
    }
    for (const raw of outcome.value) {
      const parsed = Finding.safeParse(raw);
      if (!parsed.success) {
        result.failures.push({ detectorId: adapter.id, message: `emitted an invalid Finding: ${parsed.error.message}` });
        continue;
      }
      // Enforced here as well as in each adapter: nothing leaves Detect already confirmed, and
      // only the reproduction step may write reproductionOutput.
      const { reproductionOutput: _ignored, ...rest } = parsed.data;
      const finding: Finding = { ...rest, reproducible: false };
      if (finding.detectorId !== adapter.id) {
        result.failures.push({ detectorId: adapter.id, message: `emitted a Finding with detectorId ${finding.detectorId}` });
        continue;
      }
      if (!indexed.has(finding.file)) {
        result.droppedOutsideIndex++;
        continue;
      }
      result.findings.push(finding);
    }
  };
  const runAll = async (group: DetectorAdapter[]) => {
    const settled = await Promise.allSettled(group.map((a) => a.run(workspace, exec)));
    settled.forEach((outcome, i) => collect(group[i]!, outcome));
  };

  await runAll(adapters.filter((a) => !RUNS_TARGET_CODE.has(a.id)));

  // Install once the static scanners are done, before anything that runs the target's code: the
  // detectors below, the reproduction step, and lane 3's Repair and Challenger, which work in this
  // same workspace. A failed install is reported, not fatal: plenty still runs without it.
  const install = options.install === null ? undefined : (options.install ?? installFor(exec));
  if (install) {
    try {
      result.install = await install(workspace);
      for (const step of result.install.steps.filter((s) => !s.ok)) {
        const last = step.output.split("\n").filter(Boolean).at(-1) ?? "";
        result.failures.push({
          detectorId: "dependency-install",
          message: `${step.ecosystem} ${step.phase} failed (exit ${step.exitCode}${step.timedOut ? ", timed out" : ""}): ${last}`,
        });
      }
    } catch (error) {
      result.failures.push({ detectorId: "dependency-install", message: String((error as Error)?.message ?? error) });
    }
  }

  await runAll(adapters.filter((a) => RUNS_TARGET_CODE.has(a.id)));
  return result;
}
