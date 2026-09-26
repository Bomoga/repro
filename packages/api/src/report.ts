import type { Finding, Patch, Run } from "@repro/contracts";
import { isVerifiedStatus } from "./store/invariants.ts";
import type { RunLogRecord, RunStore } from "./store/types.ts";

export type ReportedStage = Exclude<Run["stage"], "done">;

/** How far a finding got: decided by its diagnosis's latest repair attempt. */
export type FindingJourneyStatus = "detected" | "reproduced" | "diagnosed" | "repaired" | "verified" | "merged" | "rejected";

/** What a Run found, reproduced, and fixed, and what that took. Every number is counted from the Run Store and the Run's log; none comes from a model. */
export interface RunReport {
  runId: string;
  generatedAt: string;
  stats: {
    rawFindings: number;
    reproducedFindings: number;
    /** Flagged by a detector but never reproduced. */
    noiseCut: number;
    /** Findings cited by a diagnosis that Repair attempted. */
    findingsIntoRepair: number;
    /** Every repair attempt, retries included. */
    patchesAttempted: number;
    /** Attempts that passed the Verification gate, including the ones since merged. */
    patchesVerified: number;
    challengerDisputes: number;
    patchesMerged: number;
    regressionsFound: number;
    /** Of the diagnoses Repair attempted, the share whose latest attempt passed the gate, 0..1. */
    successRate: number;
    /** From the Run's start to its completed or failed event, or to now while it's in flight. Null while queued, or when a finished Run's end wasn't logged. */
    totalDurationMs: number | null;
    /** Wall time in each stage, from the orchestrator's stage events. Repair and verify alternate once per diagnosis; ingest includes any time queued. */
    timePerStageMs: Partial<Record<ReportedStage, number>>;
    /** Gemini usage summed over every interaction in the Run's log. */
    geminiTokens: { input: number; output: number; thought: number; cached: number };
    /** Input, output, and thought tokens per verified fix; null until a fix is verified. */
    tokensPerFix: number | null;
  };
  findings: {
    id: string;
    severity: Finding["severity"];
    message: string;
    file: string;
    lineStart: number;
    reproducible: boolean;
    diagnosedAt?: string;
    /** The pull request opened for the fix, once there is one. */
    prUrl?: string;
    status: FindingJourneyStatus;
  }[];
}

export async function buildReport(store: RunStore, runId: string, options: { now?: Date } = {}): Promise<RunReport> {
  const now = options.now ?? new Date();
  const run = await store.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const [findings, diagnoses, patches, logs] = await Promise.all([
    store.listFindings(runId),
    store.listDiagnoses(runId),
    store.listPatches(runId),
    store.listLogs(runId),
  ]);

  // Patches list in the order stored, and a retry is stored after the attempt it replaces, so the
  // last Patch for each diagnosis is its latest attempt.
  const latestAttempt = new Map<string, Patch>();
  for (const patch of patches) latestAttempt.set(patch.diagnosisId, patch);
  const repaired = diagnoses.filter((d) => latestAttempt.has(d.id));
  const fixes = repaired.filter((d) => isVerifiedStatus(latestAttempt.get(d.id)!.status)).length;

  const reproducedFindings = findings.filter((f) => f.reproducible).length;
  const timeline = stageTimeline(run, logs, now.getTime());
  const geminiTokens = tokenUsage(logs);
  const tokensSpent = geminiTokens.input + geminiTokens.output + geminiTokens.thought;

  return {
    runId,
    generatedAt: now.toISOString(),
    stats: {
      rawFindings: findings.length,
      reproducedFindings,
      noiseCut: findings.length - reproducedFindings,
      findingsIntoRepair: new Set(repaired.flatMap((d) => d.findingIds)).size,
      patchesAttempted: patches.length,
      patchesVerified: patches.filter((p) => isVerifiedStatus(p.status)).length,
      challengerDisputes: patches.filter((p) => p.challengerVerdict === "disputed").length,
      patchesMerged: patches.filter((p) => p.status === "merged").length,
      regressionsFound: patches.reduce((sum, p) => sum + p.regressionFindings.length, 0),
      successRate: repaired.length > 0 ? fixes / repaired.length : 0,
      totalDurationMs: timeline.totalDurationMs,
      timePerStageMs: timeline.timePerStageMs,
      geminiTokens,
      tokensPerFix: fixes > 0 ? Math.round(tokensSpent / fixes) : null,
    },
    findings: findings.map((f) => {
      const diagnosis = diagnoses.find((d) => d.findingIds.includes(f.id));
      const patch = diagnosis ? latestAttempt.get(diagnosis.id) : undefined;
      let status: FindingJourneyStatus = f.reproducible ? "reproduced" : "detected";
      if (diagnosis) status = "diagnosed";
      if (patch) status = patch.status === "proposed" ? "repaired" : patch.status;
      return {
        id: f.id,
        severity: f.severity,
        message: f.message,
        file: f.file,
        lineStart: f.lineStart,
        reproducible: f.reproducible,
        diagnosedAt: diagnosis?.createdAt,
        prUrl: patch?.prUrl,
        status,
      };
    }),
  };
}

/** The orchestrator's pipeline events (`RunLog.event`): kind "orchestrator", the event's name in `entry.event`. */
interface PipelineEvent {
  at: number;
  event: string;
  stage?: string;
}

function pipelineEvents(logs: RunLogRecord[]): PipelineEvent[] {
  const events: PipelineEvent[] = [];
  for (const log of logs) {
    const entry = log.entry as { event?: unknown; stage?: unknown } | null;
    if (log.kind !== "orchestrator" || typeof entry?.event !== "string") continue;
    events.push({ at: Date.parse(log.at), event: entry.event, stage: typeof entry.stage === "string" ? entry.stage : undefined });
  }
  return events.sort((a, b) => a.at - b.at);
}

/**
 * Splits the Run's time by stage. The orchestrator logs a "stage" event on entering every stage but
 * ingest, which starts with the Run; the Run ends at its "completed" or "failed" event.
 */
function stageTimeline(run: Run, logs: RunLogRecord[], now: number): Pick<RunReport["stats"], "totalDurationMs" | "timePerStageMs"> {
  if (run.status === "queued") return { totalDurationMs: null, timePerStageMs: {} };
  const events = pipelineEvents(logs);
  const start = Date.parse(run.startedAt);
  const finished = run.status === "completed" || run.status === "failed";
  const end = finished ? events.find((e) => e.event === "completed" || e.event === "failed")?.at : now;
  if (end === undefined) return { totalDurationMs: null, timePerStageMs: {} };

  const timePerStageMs: Partial<Record<ReportedStage, number>> = {};
  let current: { stage: ReportedStage; since: number } = { stage: "ingest", since: start };
  const close = (until: number) => {
    timePerStageMs[current.stage] = (timePerStageMs[current.stage] ?? 0) + Math.max(0, until - current.since);
  };
  for (const event of events) {
    if (event.event !== "stage" || !isReportedStage(event.stage) || event.at > end) continue;
    close(event.at);
    current = { stage: event.stage, since: event.at };
  }
  close(end);
  return { totalDurationMs: Math.max(0, end - start), timePerStageMs };
}

const REPORTED_STAGES = new Set<string>(["ingest", "detect", "diagnose", "repair", "verify"] satisfies ReportedStage[]);

function isReportedStage(stage: string | undefined): stage is ReportedStage {
  return stage !== undefined && REPORTED_STAGES.has(stage);
}

/** Sums the token usage the Gemini wrapper logs with each interaction (kind "gemini", at `entry.response.usage`). */
function tokenUsage(logs: RunLogRecord[]): RunReport["stats"]["geminiTokens"] {
  const total = { input: 0, output: 0, thought: 0, cached: 0 };
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  for (const log of logs) {
    if (log.kind !== "gemini") continue;
    const usage = (log.entry as { response?: { usage?: Record<string, unknown> } } | null)?.response?.usage;
    if (!usage) continue;
    total.input += count(usage.inputTokens);
    total.output += count(usage.outputTokens);
    total.thought += count(usage.thoughtTokens);
    total.cached += count(usage.cachedTokens);
  }
  return total;
}
