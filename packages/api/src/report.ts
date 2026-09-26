import type { Run, RunReport, Finding } from "@repro/contracts";
import type { RunStore } from "./store/types.ts";

/**
 * Build a complete analytics report for a run.
 * Every stat is deterministic from the Run Store—no model output in numbers.
 * Findings include their journey from detection through merge.
 */
export async function buildReport(store: RunStore, runId: string): Promise<RunReport> {
  const run = await store.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const findings = await store.listFindings(runId);
  const diagnoses = await store.listDiagnoses(runId);
  const patches = await store.listPatches(runId);
  const logs = await store.listLogs(runId);

  const reproducedFindings = findings.filter((f) => f.reproducible).length;
  const patchesVerified = patches.filter((p) => p.status === "verified").length;
  const patchesMerged = patches.filter((p) => p.status === "merged").length;
  const challengerDisputes = patches.filter((p) => p.challengerVerdict === "disputed").length;
  const regressionFindings = patches.reduce((sum, p) => sum + p.regressionFindings.length, 0);

  // Time per stage: orchestrator logs record stage events in entry.event
  // Parse event timestamps to compute stage durations
  const eventsByStageStart: Record<string, string> = {};
  const eventsByStageEnd: Record<string, string> = {};
  for (const log of logs) {
    if (log.kind === "orchestrator" && typeof log.entry === "object" && log.entry !== null) {
      const evt = (log.entry as any).event;
      const stage = evt?.split("_")?.[0];
      if (evt?.endsWith("_started")) eventsByStageStart[stage] = log.at;
      if (evt?.endsWith("_complete")) eventsByStageEnd[stage] = log.at;
    }
  }

  const stages = ["ingest", "detect", "diagnose", "repair", "verify"];
  const avgTimePerStageMs: Record<string, number> = {};
  for (const stage of stages) {
    if (eventsByStageStart[stage] && eventsByStageEnd[stage]) {
      const startTime = new Date(eventsByStageStart[stage]).getTime();
      const endTime = new Date(eventsByStageEnd[stage]).getTime();
      avgTimePerStageMs[stage] = Math.round(endTime - startTime);
    }
  }

  const startTime = new Date(run.startedAt).getTime();
  const endTime = new Date().getTime();
  const totalDurationMs = endTime - startTime;

  const successRate = patches.length > 0 ? patchesVerified / patches.length : 0;

  // Estimated cost: tally gemini log tokens (input + output per interaction)
  // Gemini pricing: ~$0.075/1M input, ~$0.3/1M output (Claude 3.5 Sonnet approximate)
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const log of logs) {
    if (log.kind === "gemini" && typeof log.entry === "object" && log.entry !== null) {
      const entry = log.entry as any;
      totalInputTokens += entry.usageMetadata?.promptTokenCount || 0;
      totalOutputTokens += entry.usageMetadata?.candidatesTokenCount || 0;
    }
  }
  const estimatedCostPerFix =
    totalInputTokens * 0.000000075 + totalOutputTokens * 0.0000003 / Math.max(patchesMerged, 1);

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
      patchedAt: diagnosis?.createdAt || undefined,
      verifiedAt: patch?.status === "verified" || patch?.status === "merged" ? diagnosis?.createdAt : undefined,
      mergedAt: patch?.status === "merged" ? diagnosis?.createdAt : undefined,
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
