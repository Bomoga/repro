import { type DetectorAdapter, type Executor, Finding, type Workspace } from "@repro/contracts";
import { gitleaksAdapter } from "./adapters/gitleaks.ts";
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
}

export function defaultAdapters(): DetectorAdapter[] {
  return [semgrepAdapter, gitleaksAdapter, privacyPatternsAdapter];
}

// The Deterministic Detection Engine: runs every enabled adapter, nothing else. No model calls,
// and it only ever talks to adapters through the DetectorAdapter interface.
export async function detect(
  workspace: Workspace,
  exec: Executor,
  adapters: DetectorAdapter[] = defaultAdapters(),
): Promise<DetectResult> {
  const indexed = new Set(workspace.fileIndex);
  const settled = await Promise.allSettled(adapters.map((a) => a.run(workspace, exec)));

  const findings: Finding[] = [];
  const failures: DetectorFailure[] = [];
  let droppedOutsideIndex = 0;

  settled.forEach((outcome, i) => {
    const adapter = adapters[i]!;
    if (outcome.status === "rejected") {
      failures.push({ detectorId: adapter.id, message: String(outcome.reason?.message ?? outcome.reason) });
      return;
    }
    for (const raw of outcome.value) {
      const parsed = Finding.safeParse(raw);
      if (!parsed.success) {
        failures.push({ detectorId: adapter.id, message: `emitted an invalid Finding: ${parsed.error.message}` });
        continue;
      }
      // Enforced here as well as in each adapter: nothing leaves Detect already confirmed, and
      // only the reproduction step may write reproductionOutput.
      const { reproductionOutput: _ignored, ...rest } = parsed.data;
      const finding: Finding = { ...rest, reproducible: false };
      if (finding.detectorId !== adapter.id) {
        failures.push({ detectorId: adapter.id, message: `emitted a Finding with detectorId ${finding.detectorId}` });
        continue;
      }
      if (!indexed.has(finding.file)) {
        droppedOutsideIndex++;
        continue;
      }
      findings.push(finding);
    }
  });

  return { findings, failures, droppedOutsideIndex };
}
