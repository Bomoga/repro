import {
  MAX_ATTEMPTS_PER_DIAGNOSIS,
  MAX_CHALLENGER_TOOL_CALLS,
  RequestBudget,
  diagnose,
  isBudgetExhausted,
  isDailyQuotaExhausted,
  isRepairEligible,
  repairAndVerify,
  type CounterTestRun,
  type GeminiClient,
  type InteractionLog,
  type RepairProgress,
  type ToolCallRecord,
} from "@repro/agents";
import type { RunStore } from "@repro/api";
import type { DetectorAdapter, Diagnosis, Executor, Patch, Run, Workspace } from "@repro/contracts";
import { defaultAdapters, detect, redactSecrets, reproduce } from "@repro/detect";
import { ingest, removeWorkspace } from "@repro/ingest";
import type { PullRequestOpener } from "./pull-request.ts";
import { RunLog } from "./run-log.ts";

/** The stage implementations, injectable so tests can run the pipeline without Docker or Gemini. */
export interface Stages {
  ingest: typeof ingest;
  removeWorkspace: typeof removeWorkspace;
  detect: typeof detect;
  reproduce: typeof reproduce;
  diagnose: typeof diagnose;
  repairAndVerify: typeof repairAndVerify;
}

const STAGES: Stages = { ingest, removeWorkspace, detect, reproduce, diagnose, repairAndVerify };

export interface PipelineDeps {
  store: RunStore;
  /** The sandbox every command that touches target-repo code runs in (section 9). */
  executor: Executor;
  /** A Gemini client that records every interaction to the log it's given and charges every request
   *  to the budget it's given: both the Run's own. */
  gemini: (log: InteractionLog, budget: RequestBudget) => GeminiClient;
  /** The most requests one Run may send to the Pro-tier models (REPRO_PRO_REQUEST_BUDGET); unset, no cap. */
  proRequestBudget?: number;
  /** Every enabled detector. Defaults to Lane 2's. */
  detectors?: DetectorAdapter[];
  /** Opens a PR for each verified Patch; without one, verified Patches wait in the Run Store. */
  pullRequests?: PullRequestOpener;
  workspacesRoot?: string;
  keepWorkspace?: boolean;
  /** One line per step, for the orchestrator's console. */
  say?: (line: string) => void;
  stages?: Partial<Stages>;
}

const messageOf = (error: unknown) => redactSecrets(error instanceof Error ? error.message : String(error));

/** The most Pro-tier requests one Diagnosis's repair can take: every attempt, each with a full Challenger conversation. */
export const PRO_REQUESTS_PER_DIAGNOSIS = MAX_ATTEMPTS_PER_DIAGNOSIS * (MAX_CHALLENGER_TOOL_CALLS + 3);

/**
 * Takes one claimed Run (running, at stage "ingest") through the pipeline, writing each stage's
 * output to the Run Store as it lands. Ends the Run completed at "done", or failed in the stage
 * that broke. Never throws: a failure belongs to the Run, not to the orchestrator.
 */
export async function processRun(claimed: Run, deps: PipelineDeps): Promise<Run> {
  const { store, executor } = deps;
  const stages = { ...STAGES, ...deps.stages };
  const detectors = deps.detectors ?? defaultAdapters();
  const runId = claimed.id;
  const log = new RunLog(store, runId);
  const say = (line: string) => deps.say?.(`[${runId}] ${line}`);
  const budget = new RequestBudget(deps.proRequestBudget);
  const logRequests = () => {
    const byModel = budget.requestsByModel();
    log.event("gemini-requests", { byModel, proRequests: budget.proRequests, ...(budget.limit !== undefined ? { proLimit: budget.limit } : {}) });
    const counts = Object.entries(byModel).map(([model, count]) => `${model} ${count}`);
    if (counts.length > 0) say(`gemini requests: ${counts.join(", ")}${budget.limit !== undefined ? ` (Pro-tier ${budget.proRequests} of ${budget.limit})` : ""}`);
  };

  let stage = claimed.stage;
  const enter = async (next: Exclude<Run["stage"], "done">) => {
    stage = next;
    await store.updateRun(runId, { stage: next });
    log.event("stage", { stage: next });
    say(next);
  };

  let workspace: Workspace | undefined;
  try {
    say(`ingest ${claimed.target.kind}:${claimed.target.ref}`);
    workspace = await stages.ingest(runId, claimed.target, { workspacesRoot: deps.workspacesRoot });
    log.event("ingested", { headCommit: workspace.headCommit, files: workspace.fileIndex.length, languages: workspace.languages });

    await enter("detect");
    const detected = await stages.detect(workspace, executor, detectors);
    await store.addFindings(runId, detected.findings);
    const failures = detected.failures.map((failure) => ({ detectorId: failure.detectorId, message: redactSecrets(failure.message) }));
    log.event("detected", { findings: detected.findings.length, failures, droppedOutsideIndex: detected.droppedOutsideIndex });
    for (const failure of failures) say(`  detector ${failure.detectorId} failed: ${failure.message}`);

    const reproduced = await stages.reproduce(detected.findings, workspace, executor);
    for (const finding of reproduced.findings) {
      if (finding.reproducible) await store.recordReproduction(finding.id, finding.reproductionOutput);
    }
    const findings = reproduced.findings;
    log.event("reproduced", { attempts: reproduced.attempts });
    say(`  ${findings.length} flagged, ${findings.filter((f) => f.reproducible).length} reproduced`);

    if (findings.length > 0) {
      await enter("diagnose");
      const gemini = deps.gemini(log.interactions, budget);
      const diagnosed = await stages.diagnose({ findings, workspace }, { gemini });
      await store.addDiagnoses(runId, diagnosed.diagnoses);
      const eligible = diagnosed.diagnoses.filter((diagnosis) => isRepairEligible(diagnosis, findings));
      log.event("diagnosed", {
        diagnoses: diagnosed.diagnoses.map((d) => d.id),
        repairable: eligible.map((d) => d.id),
        dropped: diagnosed.dropped.map((d) => d.reason),
        uncoveredFindingIds: diagnosed.uncoveredFindingIds,
      });
      say(`  ${diagnosed.diagnoses.length} diagnoses, ${eligible.length} citing only reproduced findings`);

      const verified: { patch: Patch; diagnosis: Diagnosis }[] = [];
      const repairFailures: string[] = [];
      // Set when the Run stops scheduling repairs early: its request budget or a daily quota ran out.
      let stopped: { quota?: unknown; interrupted?: string; skipped: number } | undefined;
      for (const [index, diagnosis] of eligible.entries()) {
        if (budget.remaining < PRO_REQUESTS_PER_DIAGNOSIS) {
          stopped = { skipped: eligible.length - index };
          break;
        }
        if (stage !== "repair") await enter("repair");
        say(`  diagnosis ${diagnosis.id} (${diagnosis.findingIds.join(", ")})`);
        try {
          const result = await stages.repairAndVerify(
            { diagnosis, findings, workspace },
            {
              gemini,
              executor,
              detectors,
              onToolCall: (call: ToolCallRecord) => {
                log.event("tool-call", { diagnosisId: diagnosis.id, ...call });
                say(`    ${call.ok ? "ok  " : "FAIL"} ${call.name}: ${call.summary}`);
              },
              onCounterTest: (run: CounterTestRun) => {
                const { path, command, description } = run.test;
                log.event("counter-test", { diagnosisId: diagnosis.id, path, command, description, before: run.before.status, after: run.after.status, outcome: run.outcome });
                say(`    counter-test ${path}: ${run.before.status} before, ${run.after.status} after (${run.outcome})`);
              },
              onProgress: async (progress: RepairProgress) => {
                if (progress.type === "repairing") return stage === "repair" ? undefined : enter("repair");
                await store.savePatch(runId, progress.patch);
                if (progress.type === "challenging") return enter("verify");
                say(`    attempt ${progress.attempt}: patch ${progress.patch.id} ${progress.patch.status}`);
              },
            },
          );
          if (result.patch.status === "verified") verified.push({ patch: result.patch, diagnosis });
        } catch (error) {
          // Neither a spent budget nor a spent daily quota comes back within this Run: every later
          // diagnosis would fail the same way, so scheduling stops and what's verified is kept.
          if (isBudgetExhausted(error) || isDailyQuotaExhausted(error)) {
            stopped = { ...(isDailyQuotaExhausted(error) ? { quota: error } : {}), interrupted: diagnosis.id, skipped: eligible.length - index - 1 };
            break;
          }
          repairFailures.push(messageOf(error));
          log.event("repair-failed", { diagnosisId: diagnosis.id, message: messageOf(error) });
          say(`    repair failed: ${messageOf(error)}`);
        }
      }
      if (stopped && !stopped.quota) {
        log.event("budget-reached", {
          proLimit: budget.limit,
          proRequests: budget.proRequests,
          byModel: budget.requestsByModel(),
          verified: verified.length,
          diagnosesSkipped: stopped.skipped,
          ...(stopped.interrupted ? { interrupted: stopped.interrupted } : {}),
        });
        say(`  Pro-tier request budget reached (${budget.proRequests} of ${budget.limit}): ${stopped.skipped} diagnoses skipped${stopped.interrupted ? `, ${stopped.interrupted} cut short` : ""}`);
      }
      if (!stopped && eligible.length > 0 && repairFailures.length === eligible.length) {
        throw new Error(`every repair failed; the last: ${repairFailures[repairFailures.length - 1]}`);
      }

      for (const { patch, diagnosis } of deps.pullRequests ? verified : []) {
        try {
          const prUrl = await deps.pullRequests!.open({ run: claimed, workspace, patch, diagnosis, findings, gemini });
          if (!prUrl) continue;
          await store.savePatch(runId, { ...patch, prUrl });
          log.event("pull-request", { patchId: patch.id, prUrl });
          say(`  PR for ${patch.id}: ${prUrl}`);
        } catch (error) {
          log.event("pull-request-failed", { patchId: patch.id, message: messageOf(error) });
          say(`  no PR for ${patch.id}: ${messageOf(error)}`);
        }
      }
      // A spent daily quota fails the Run, but only once the patches it had verified have their PRs.
      if (stopped?.quota) throw stopped.quota;
    }

    const done = await store.updateRun(runId, { stage: "done", status: "completed" });
    logRequests();
    log.event("completed");
    say("completed");
    return done;
  } catch (error) {
    logRequests();
    log.event("failed", { stage, message: messageOf(error) });
    say(`failed in ${stage}: ${messageOf(error)}`);
    return store.updateRun(runId, { status: "failed" }).catch(async () => (await store.getRun(runId)) ?? { ...claimed, stage, status: "failed" });
  } finally {
    await log.flush().catch((error: unknown) => say(`run log incomplete: ${messageOf(error)}`));
    if (workspace && !deps.keepWorkspace) {
      try {
        stages.removeWorkspace(workspace);
      } catch (error) {
        say(`couldn't remove workspace ${workspace.path}: ${messageOf(error)}`);
      }
    }
  }
}
