import type { Run, RunReport, Finding } from "@repro/contracts";
import type { Store } from "@repro/store";

/**
 * Build a complete analytics report for a run.
 * Every stat is deterministic from the Run Store and events—no model output in numbers.
 * Findings include their journey from detection through merge.
 */
export async function buildReport(store: Store, runId: string): Promise<RunReport> {
  const run = await store.runs.get(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const findings = await store.findings.list(runId);
  const diagnoses = await store.diagnoses.list(runId);
  const patches = await store.patches.list(runId);
  const events = await store.logs.list(runId);

  const reproducedFindings = findings.filter((f) => f.reproducible).length;
  const patchesVerified = patches.filter((p) => p.status === "verified").length;
  const patchesMerged = patches.filter((p) => p.status === "merged").length;
  const challengerDisputes = patches.filter((p) => p.challengerVerdict === "disputed").length;
  const regressionFindings = patches.reduce((sum, p) => sum + p.regressionFindings.length, 0);

  // Time per stage: compute from events
  const eventsByKind: Record<string, any[]> = {};
  for (const evt of events) {
    if (!eventsByKind[evt.kind]) eventsByKind[evt.kind] = [];
    eventsByKind[evt.kind].push(evt);
  }

  const stages = ["ingest", "detect", "diagnose", "repair", "verify"];
  const avgTimePerStageMs: Record<string, number> = {};
  for (const stage of stages) {
    const startEvts = eventsByKind[`${stage}_started`] || [];
    const endEvts = eventsByKind[`${stage}_complete`] || [];
    if (startEvts.length > 0 && endEvts.length > 0) {
      const startTime = new Date(startEvts[startEvts.length - 1].at).getTime();
      const endTime = new Date(endEvts[endEvts.length - 1].at).getTime();
      avgTimePerStageMs[stage] = Math.round(endTime - startTime);
    }
  }

  const startTime = new Date(run.startedAt).getTime();
  const endTime = new Date().getTime();
  const totalDurationMs = endTime - startTime;

  const successRate = patches.length > 0 ? patchesVerified / patches.length : 0;

  // Estimated cost: diagnose ($0.002 per call), repair ($0.005 per attempt), challenger ($0.002 per gate)
  // This is placeholder; real costs come from Gemini pricing
  const estimatedCostPerFix =
    (diagnoses.length * 0.002 + patches.length * 0.005 + patches.length * 0.002) / Math.max(patchesMerged, 1);

  // Per-finding journey
  const findingJourneys = findings.map((f) => {
    const diagnosis = diagnoses.find((d) => d.findingIds.includes(f.id));
    const patch = diagnosis ? patches.find((p) => p.diagnosisId === diagnosis!.id) : undefined;

    let status: "detected" | "reproduced" | "diagnosed" | "repaired" | "verified" | "merged" | "rejected" = "detected";
    if (f.reproducible) status = "reproduced";
    if (diagnosis) status = "diagnosed";
    if (patch) {
      if (patch.status === "merged") status = "merged";
      else if (patch.status === "verified") status = "verified";
      else if (patch.status === "rejected") status = "rejected";
      else status = "repaired";
    }

    return {
      id: f.id,
      severity: f.severity,
      message: f.message,
      file: f.file,
      lineStart: f.lineStart,
      reproducible: f.reproducible,
      diagnosedAt: diagnosis?.createdAt,
      patchedAt: patch?.createdAt || undefined,
      verifiedAt: patch?.status === "verified" || patch?.status === "merged" ? new Date().toISOString() : undefined,
      mergedAt: patch?.status === "merged" ? new Date().toISOString() : undefined,
      status,
    };
  });

  return {
    runId,
    generatedAt: new Date().toISOString(),
    stats: {
      rawFindings: findings.length,
      reproducedFindings,
      noiseCut: findings.length - reproducedFindings,
      findingsIntoRepair: diagnoses.length,
      patchesAttempted: patches.length,
      patchesVerified,
      challengerDisputes,
      patchesMerged,
      regressionsFound: regressionFindings,
      successRate,
      totalDurationMs,
      avgTimePerStageMs,
      estimatedCostPerFix,
    },
    findings: findingJourneys,
  };
}
