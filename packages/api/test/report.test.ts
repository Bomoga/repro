import { beforeEach, describe, expect, it } from "vitest";
import { buildReport } from "../src/report.ts";
import { InMemoryRunStore } from "../src/store/index.ts";
import { aDiagnosis, aFinding, aReproducedFinding, aRun, aVerifiedPatch } from "./helpers/fixtures.ts";

// buildReport against the in-memory store, with log entries shaped the way the orchestrator's
// RunLog ("orchestrator", event name in entry.event) and the Gemini wrapper ("gemini", usage at
// entry.response.usage) write them.

const START = "2026-09-26T10:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(START) + seconds * 1000).toISOString();

let store: InMemoryRunStore;

beforeEach(() => {
  store = new InMemoryRunStore();
});

describe("buildReport", () => {
  it("judges each finding by its diagnosis's latest attempt, and counts merged fixes as verified", async () => {
    const run = await store.insertRun(aRun({ stage: "done", status: "completed", startedAt: START }));
    const fixed = aReproducedFinding();
    const unfixed = aReproducedFinding({ file: "src/share.js" });
    const noise = aFinding({ file: "src/style.css" });
    await store.addFindings(run.id, [fixed, unfixed, noise]);
    const [first, second] = [aDiagnosis([fixed.id]), aDiagnosis([unfixed.id])];
    await store.addDiagnoses(run.id, [first, second]);
    await store.savePatch(run.id, aVerifiedPatch(first.id, { status: "rejected", challengerVerdict: "disputed" }));
    const retry = await store.savePatch(run.id, aVerifiedPatch(first.id, { prUrl: "https://github.com/octo/example/pull/2" }));
    await store.setPatchDecision(retry.id, "merge");
    await store.savePatch(run.id, aVerifiedPatch(second.id, { status: "rejected", challengerVerdict: "disputed" }));

    const report = await buildReport(store, run.id);

    expect(report.findings.map((f) => f.status)).toEqual(["merged", "rejected", "detected"]);
    expect(report.findings[0]!.prUrl).toBe("https://github.com/octo/example/pull/2");
    expect(report.stats).toMatchObject({
      rawFindings: 3,
      reproducedFindings: 2,
      noiseCut: 1,
      findingsIntoRepair: 2,
      patchesAttempted: 3,
      patchesVerified: 1,
      patchesMerged: 1,
      challengerDisputes: 2,
      successRate: 0.5,
    });
  });

  it("splits a finished run's time by stage from its pipeline events, and stops the clock at its end", async () => {
    const run = await store.insertRun(aRun({ stage: "done", status: "completed", startedAt: START }));
    const events: [number, Record<string, unknown>][] = [
      [5, { event: "ingested", files: 20 }],
      [5, { event: "stage", stage: "detect" }],
      [65, { event: "stage", stage: "diagnose" }],
      [95, { event: "stage", stage: "repair" }],
      [155, { event: "stage", stage: "verify" }],
      [215, { event: "stage", stage: "repair" }],
      [245, { event: "stage", stage: "verify" }],
      [305, { event: "completed" }],
    ];
    for (const [seconds, entry] of events) await store.appendLog(run.id, "orchestrator", entry, at(seconds));

    const report = await buildReport(store, run.id, { now: new Date(at(3_600)) });

    expect(report.stats.totalDurationMs).toBe(305_000);
    expect(report.stats.timePerStageMs).toEqual({ ingest: 5_000, detect: 60_000, diagnose: 30_000, repair: 90_000, verify: 120_000 });
  });

  it("measures a run in flight up to now, and a queued one not at all", async () => {
    const running = await store.insertRun(aRun({ stage: "detect", status: "running", startedAt: START }));
    await store.appendLog(running.id, "orchestrator", { event: "stage", stage: "detect" }, at(10));
    const inFlight = await buildReport(store, running.id, { now: new Date(at(40)) });
    expect(inFlight.stats.totalDurationMs).toBe(40_000);
    expect(inFlight.stats.timePerStageMs).toEqual({ ingest: 10_000, detect: 30_000 });

    const queued = await store.insertRun(aRun({ stage: "ingest", status: "queued", startedAt: START }));
    const waiting = await buildReport(store, queued.id, { now: new Date(at(40)) });
    expect(waiting.stats).toMatchObject({ totalDurationMs: null, timePerStageMs: {}, tokensPerFix: null, successRate: 0 });
  });

  it("sums the token usage logged with each Gemini interaction, per verified fix", async () => {
    const run = await store.insertRun(aRun({ stage: "done", status: "completed", startedAt: START }));
    const finding = aReproducedFinding();
    await store.addFindings(run.id, [finding]);
    const diagnosis = aDiagnosis([finding.id]);
    await store.addDiagnoses(run.id, [diagnosis]);
    await store.savePatch(run.id, aVerifiedPatch(diagnosis.id));
    const interaction = (response: unknown) => ({ role: "repair", model: "gemini-3.8-flash", response });
    await store.appendLog(run.id, "gemini", interaction({ usage: { inputTokens: 1_000, outputTokens: 200, thoughtTokens: 300, cachedTokens: 600 } }), at(1));
    await store.appendLog(run.id, "gemini", interaction({ usage: { inputTokens: 500, outputTokens: 100 } }), at(2));
    await store.appendLog(run.id, "gemini", { role: "repair", model: "gemini-3.8-flash", error: { status: 429, message: "quota" } }, at(3));

    const { stats } = await buildReport(store, run.id);

    expect(stats.geminiTokens).toEqual({ input: 1_500, output: 300, thought: 300, cached: 600 });
    expect(stats.tokensPerFix).toBe(2_100);
  });
});
