// `npx tsx scripts/run-stats.ts [runId...]`: every number the results page shows, computed from
// the Run Store and each Run's log (MONGODB_URI from .env). No model output in any number.
import { existsSync } from "node:fs";
import { MongoRunStore } from "@repro/api";

if (existsSync(".env")) process.loadEnvFile(".env");
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is not set");
const store = await MongoRunStore.connect(uri, { dbName: process.env.MONGODB_DB || undefined });

type Usage = { inputTokens?: number; outputTokens?: number; thoughtTokens?: number; cachedTokens?: number };

try {
  const runs = process.argv.length > 2 ? await Promise.all(process.argv.slice(2).map((id) => store.getRun(id))) : await store.listRuns({ limit: 50 });
  const out = [];
  for (const run of runs) {
    if (!run) continue;
    const [findings, diagnoses, patches, logs] = await Promise.all([store.listFindings(run.id), store.listDiagnoses(run.id), store.listPatches(run.id), store.listLogs(run.id)]);
    const tokens = { input: 0, output: 0, thought: 0, cached: 0, requests: 0 };
    const byModel: Record<string, number> = {};
    const byRole: Record<string, { requests: number; tokens: number }> = {};
    const stageAt: Record<string, number> = {};
    let first = Number.POSITIVE_INFINITY;
    let last = 0;
    for (const log of logs) {
      const t = Date.parse(log.at);
      first = Math.min(first, t);
      last = Math.max(last, t);
      const entry = log.entry as Record<string, unknown>;
      if (log.kind === "gemini") {
        const usage = (entry.response as { usage?: Usage } | undefined)?.usage;
        tokens.requests += 1;
        tokens.input += usage?.inputTokens ?? 0;
        tokens.output += usage?.outputTokens ?? 0;
        tokens.thought += usage?.thoughtTokens ?? 0;
        tokens.cached += usage?.cachedTokens ?? 0;
        const role = String(entry.role ?? "unknown");
        byRole[role] ??= { requests: 0, tokens: 0 };
        byRole[role].requests += 1;
        byRole[role].tokens += (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) + (usage?.thoughtTokens ?? 0);
        const model = String(entry.model ?? "unknown");
        byModel[model] = (byModel[model] ?? 0) + 1;
      }
      if (log.kind === "orchestrator" && entry.event === "stage") stageAt[String((entry as { stage?: string }).stage)] ??= t;
    }
    const notChallenged = patches.filter((p) => (p.challengerNotes ?? "").startsWith("Not challenged")).length;
    out.push({
      id: run.id,
      target: run.target.ref,
      status: run.status,
      stage: run.stage,
      findings: findings.length,
      reproduced: findings.filter((f) => f.reproducible).length,
      byDetector: Object.fromEntries([...new Set(findings.map((f) => f.detectorId))].map((d) => [d, findings.filter((f) => f.detectorId === d).length])),
      bySeverity: Object.fromEntries(["critical", "high", "medium", "low", "info"].map((s) => [s, findings.filter((f) => f.severity === s).length])),
      diagnoses: diagnoses.length,
      patches: patches.length,
      verified: patches.filter((p) => p.status === "verified" || p.status === "merged").length,
      rejected: patches.filter((p) => p.status === "rejected").length,
      rejectedBeforeChallenger: notChallenged,
      challengerDisputes: patches.filter((p) => p.challengerVerdict === "disputed" && !(p.challengerNotes ?? "").startsWith("Not")).length,
      regressionsCaught: patches.reduce((n, p) => n + p.regressionFindings.length, 0),
      stillReproducedAfterPatch: patches.filter((p) => p.originalFindingReproduces).length,
      tokens,
      byModel,
      byRole,
      logSpanMs: Number.isFinite(first) ? last - first : 0,
      stageStartOffsetsMs: Object.fromEntries(Object.entries(stageAt).map(([s, t]) => [s, t - first])),
    });
  }
  console.log(JSON.stringify(out, null, 2));
} finally {
  await store.close();
}
