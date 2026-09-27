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
import type { DetectorAdapter, Diagnosis, Executor, Finding, Patch, Run, Workspace } from "@repro/contracts";
import { defaultAdapters, detect, redactSecrets, reproduce } from "@repro/detect";
import { ingest, removeWorkspace } from "@repro/ingest";
import type { PullRequestOpener } from "./pull-request.ts";
import { RunLog } from "./run-log.ts";
import { gitWorkspaceCopies, type WorkspaceCopies } from "./workspace-copy.ts";

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
  gemini?: (log: InteractionLog, budget: RequestBudget) => GeminiClient;
  /** The most requests one Run may send to the Pro-tier models (REPRO_PRO_REQUEST_BUDGET); unset, no cap. */
  proRequestBudget?: number;
  /** How many Diagnoses one Run repairs at once (REPRO_REPAIR_CONCURRENCY). 1, the default, repairs
   *  them one after another in the Run's workspace; above 1, each gets its own copy of it. */
  repairConcurrency?: number;
  /** Makes and removes those copies. Defaults to git clones made the way Ingest makes workspaces. */
  workspaceCopies?: WorkspaceCopies;
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
  // Stage writes queue behind each other, so when repairs running at once move the stage, the
  // stored stage can't land out of order.
  let stageWrites: Promise<void> = Promise.resolve();
  const enter = (next: Exclude<Run["stage"], "done">): Promise<void> => {
    stage = next;
    stageWrites = stageWrites
      .catch(() => undefined)
      .then(async () => {
        await store.updateRun(runId, { stage: next });
        log.event("stage", { stage: next });
        say(next);
      });
    return stageWrites;
  };

  /**
   * Repairs the eligible Diagnoses, `repairConcurrency` at a time: at 1, one after another in the Run's
   * workspace; above 1, each in its own copy of it, removed when it's done. A Diagnosis starts only if
   * the budget covers its worst case on top of every one in flight's. A spent budget or daily quota
   * stops scheduling; Diagnoses already in flight finish or fail on their own.
   */
  const repairAll = async (eligible: Diagnosis[], findings: Finding[], workspace: Workspace, gemini: GeminiClient) => {
    const concurrency = deps.repairConcurrency ?? 1;
    const copies = deps.workspaceCopies ?? gitWorkspaceCopies;
    const verifiedAt: (Patch | undefined)[] = [];
    const failures: string[] = [];
    const interrupted: string[] = [];
    let quota: unknown;
    let stopScheduling = false;

    // Run.stage is what's in flight (section 4): "verify" only while every Diagnosis in flight is with the Challenger.
    const phases = new Map<string, "repair" | "verify">();
    const settleStage = async () => {
      const next = [...phases.values()].includes("repair") ? "repair" : "verify";
      if (phases.size > 0 && next !== stage) await enter(next);
    };

    const repairOne = async (diagnosis: Diagnosis, index: number): Promise<void> => {
      // Lines from repairs in flight at once interleave on the console, so each carries its Diagnosis.
      const short = diagnosis.id.slice(0, 8);
      const tell = (line: string) => say(concurrency > 1 ? line.replace(/^(\s*)/, `$1[${short}] `) : line);
      let copy: Workspace | undefined;
      phases.set(diagnosis.id, "repair");
      try {
        await settleStage();
        tell(`  diagnosis ${diagnosis.id} (${diagnosis.findingIds.join(", ")})`);
        if (concurrency > 1) copy = await copies.copy(workspace, `${String(index + 1).padStart(2, "0")}-${short.replace(/[^A-Za-z0-9_-]/g, "_")}`);
        const result = await stages.repairAndVerify(
          { diagnosis, findings, workspace: copy ?? workspace },
          {
            gemini,
            executor,
            detectors,
            onToolCall: (call: ToolCallRecord) => {
              log.event("tool-call", { diagnosisId: diagnosis.id, ...call });
              tell(`    ${call.ok ? "ok  " : "FAIL"} ${call.name}: ${call.summary}`);
            },
            onCounterTest: (run: CounterTestRun) => {
              const { path, command, description } = run.test;
              log.event("counter-test", { diagnosisId: diagnosis.id, path, command, description, before: run.before.status, after: run.after.status, outcome: run.outcome });
              tell(`    counter-test ${path}: ${run.before.status} before, ${run.after.status} after (${run.outcome})`);
            },
            onProgress: async (progress: RepairProgress) => {
              if (progress.type === "repairing") {
                phases.set(diagnosis.id, "repair");
                return settleStage();
              }
              await store.savePatch(runId, progress.patch);
              if (progress.type === "challenging") {
                phases.set(diagnosis.id, "verify");
                return settleStage();
              }
              tell(`    attempt ${progress.attempt}: patch ${progress.patch.id} ${progress.patch.status}`);
            },
          },
        );
        if (result.patch.status === "verified") verifiedAt[index] = result.patch;
      } catch (error) {
        // Neither a spent budget nor a spent daily quota comes back within this Run: every later
        // diagnosis would fail the same way, so scheduling stops and what's verified is kept.
        if (isBudgetExhausted(error) || isDailyQuotaExhausted(error)) {
          stopScheduling = true;
          interrupted.push(diagnosis.id);
          if (isDailyQuotaExhausted(error)) quota ??= error;
          return;
        }
        failures.push(messageOf(error));
        log.event("repair-failed", { diagnosisId: diagnosis.id, message: messageOf(error) });
        tell(`    repair failed: ${messageOf(error)}`);
      } finally {
        phases.delete(diagnosis.id);
        if (copy && !deps.keepWorkspace) {
          try {
            await copies.remove(copy);
          } catch (error) {
            tell(`    couldn't remove workspace copy ${copy.path}: ${messageOf(error)}`);
          }
        }
      }
    };

    const inFlight = new Set<Promise<void>>();
    let next = 0;
    while (next < eligible.length && !stopScheduling) {
      if (inFlight.size >= concurrency) {
        await Promise.race(inFlight);
        continue;
      }
      if (budget.remaining - inFlight.size * PRO_REQUESTS_PER_DIAGNOSIS < PRO_REQUESTS_PER_DIAGNOSIS) {
        if (inFlight.size === 0) {
          stopScheduling = true;
          break;
        }
        await Promise.race(inFlight); // what the ones in flight leave may still cover it
        continue;
      }
      const index = next++;
      const running: Promise<void> = repairOne(eligible[index]!, index).finally(() => inFlight.delete(running));
      inFlight.add(running);
    }
    await Promise.all(inFlight);

    const verified = eligible.flatMap((diagnosis, index) => (verifiedAt[index] ? [{ patch: verifiedAt[index]!, diagnosis }] : []));
    const stopped = stopScheduling ? { quota, interrupted, skipped: eligible.length - next } : undefined;
    return { verified, failures, stopped };
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

    // Without a Gemini client the Run ends here: detection and reproduction are model-free, and
    // the reproduced Findings are real results on their own.
    if (findings.length > 0 && !deps.gemini) {
      log.event("model-stages-skipped", { reason: "no Gemini auth configured" });
      say("  no Gemini client: stopping after reproduction");
    }

    if (findings.length > 0 && deps.gemini) {
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

      const { verified, failures: repairFailures, stopped } = await repairAll(eligible, findings, workspace, gemini);
      if (stopped && stopped.quota === undefined) {
        const interrupted = stopped.interrupted.join(", ");
        log.event("budget-reached", {
          proLimit: budget.limit,
          proRequests: budget.proRequests,
          byModel: budget.requestsByModel(),
          verified: verified.length,
          diagnosesSkipped: stopped.skipped,
          ...(interrupted ? { interrupted } : {}),
        });
        say(`  Pro-tier request budget reached (${budget.proRequests} of ${budget.limit}): ${stopped.skipped} diagnoses skipped${interrupted ? `, ${interrupted} cut short` : ""}`);
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
      if (stopped?.quota !== undefined) throw stopped.quota;
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
