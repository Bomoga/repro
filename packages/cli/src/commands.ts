import type { Patch, Run } from "@repro/contracts";
import type { ApiClient } from "./client.ts";

export interface Io {
  log(line: string): void;
}

function fmtRun(run: Run): string {
  return `${run.id}  ${run.status.padEnd(9)} ${run.stage.padEnd(8)} ${run.target.kind}:${run.target.ref}  started ${run.startedAt}`;
}

function fmtPatch(patch: Patch): string {
  const decidable = patch.status === "verified" ? " [decidable: merge|reject]" : "";
  return `  ${patch.id}  ${patch.status.padEnd(9)} verdict=${patch.challengerVerdict}${decidable}`;
}

export async function runStatus(client: ApiClient, io: Io, runId?: string): Promise<void> {
  if (!runId) {
    const runs = await client.listRuns();
    if (runs.length === 0) {
      io.log("No runs yet. Start one with `repro scan <target-ref>`.");
      return;
    }
    io.log(`${runs.length} run(s):`);
    for (const run of runs) io.log(fmtRun(run));
    return;
  }

  const run = await client.getRun(runId);
  io.log(fmtRun(run));

  const [findings, diagnoses, patches] = await Promise.all([
    client.listFindings(runId),
    client.listDiagnoses(runId),
    client.listPatches(runId),
  ]);
  io.log(`  ${findings.length} finding(s), ${diagnoses.length} diagnosis(es), ${patches.length} patch(es)`);
  for (const patch of patches) io.log(fmtPatch(patch));
}

export async function runWatch(
  client: ApiClient,
  io: Io,
  runId: string,
  options: { intervalMs?: number; maxIterations?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? 5_000;
  const maxIterations = options.maxIterations ?? Infinity;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let last: { stage: Run["stage"]; status: Run["status"] } | undefined;
  const terminal = new Set<Run["status"]>(["completed", "failed"]);

  for (let i = 0; i < maxIterations; i++) {
    const run = await client.getRun(runId);
    if (!last || last.stage !== run.stage || last.status !== run.status) {
      io.log(fmtRun(run));
      last = { stage: run.stage, status: run.status };
    }
    if (terminal.has(run.status)) return;
    if (i < maxIterations - 1) await sleep(intervalMs);
  }
}

export async function runScan(client: ApiClient, io: Io, targetRef: string, targetKind: "local" | "github"): Promise<void> {
  const run = await client.createRun(targetRef, targetKind);
  io.log(`Queued ${run.id} for ${targetKind}:${targetRef}`);
  io.log(`Watch it with: repro watch ${run.id}`);
}

export async function runDecide(client: ApiClient, io: Io, patchId: string, decision: "merge" | "reject"): Promise<void> {
  const patch = await client.decidePatch(patchId, decision);
  io.log(`${patch.id} -> ${patch.status}`);
}
