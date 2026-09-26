import type { Run } from "@repro/contracts";
import { apiErrorCode, describeError, isUnreachable, type ApiClient } from "./client.ts";
import { formatDuration, painter, renderCompletion, renderRunDetail, renderRunTable, targetLabel, type Paint } from "./format.ts";
import { resolveScanTarget } from "./targets.ts";

// The commands themselves, free of argv parsing and process globals: everything they touch comes
// in through CommandContext, so tests drive them against a real API with a fake clock.
//
// Exit codes: 0 success; 1 failure (run failed, not found, bad input, API unreachable);
// 2 watch timed out with the run still in flight.

export interface CommandContext {
  client: ApiClient;
  apiUrl: string;
  out(line: string): void;
  err(line: string): void;
  color: boolean;
  now(): Date;
  sleep(ms: number): Promise<void>;
  cwd: string;
  exists?: (path: string) => boolean;
}

const FINAL: ReadonlySet<Run["status"]> = new Set(["completed", "failed"]);

/** Consecutive failed polls `watch` tolerates before giving up. */
export const WATCH_MAX_POLL_FAILURES = 5;

function paintOf(ctx: CommandContext): Paint {
  return painter(ctx.color);
}

function printJson(ctx: CommandContext, value: unknown): void {
  ctx.out(JSON.stringify(value, null, 2));
}

export interface StatusOptions {
  runId?: string;
  status?: Run["status"];
  limit?: number;
  json?: boolean;
}

export async function statusCommand(ctx: CommandContext, options: StatusOptions): Promise<number> {
  const paint = paintOf(ctx);
  if (options.runId) {
    const detail = await ctx.client.runs.detail.query({ runId: options.runId });
    if (options.json) printJson(ctx, detail);
    else for (const line of renderRunDetail(detail, ctx.now(), paint)) ctx.out(line);
    return 0;
  }

  const summaries = await ctx.client.runs.summaries.query({ status: options.status, limit: options.limit });
  if (options.json) {
    printJson(ctx, summaries);
  } else if (summaries.length === 0) {
    ctx.out(
      options.status
        ? `No ${options.status} runs.`
        : "No runs yet. Queue one with `repro scan <path | owner/repo>`.",
    );
  } else {
    for (const line of renderRunTable(summaries, ctx.now(), paint)) ctx.out(line);
  }
  return 0;
}

export interface WatchOptions {
  intervalMs: number;
  timeoutMs?: number;
  json?: boolean;
}

export async function watchCommand(ctx: CommandContext, runId: string, options: WatchOptions): Promise<number> {
  const paint = paintOf(ctx);
  const started = ctx.now().getTime();
  let last: Pick<Run, "stage" | "status"> | undefined;
  let failures = 0;

  for (;;) {
    let run: Run;
    try {
      run = await ctx.client.runs.get.query({ runId });
      failures = 0;
    } catch (error) {
      // Retry what can clear up on its own (API restarting, tunnel blip, Run Store hiccup);
      // give up at once on answers that won't change, like NOT_FOUND.
      const transient = isUnreachable(error) || apiErrorCode(error) === "INTERNAL_SERVER_ERROR";
      if (!transient || ++failures >= WATCH_MAX_POLL_FAILURES) throw error;
      ctx.err(`poll failed (${failures}/${WATCH_MAX_POLL_FAILURES}), retrying: ${describeError(error, ctx.apiUrl)}`);
      await ctx.sleep(options.intervalMs);
      continue;
    }

    const elapsed = ctx.now().getTime() - started;
    if (!last || last.stage !== run.stage || last.status !== run.status) {
      if (options.json) ctx.out(JSON.stringify(run));
      else ctx.out(`${formatDuration(elapsed).padStart(6)}  ${paint(run.status === "failed" ? "red" : run.status === "completed" ? "green" : "cyan", run.status.padEnd(9))} ${run.stage}`);
      last = { stage: run.stage, status: run.status };
    }

    if (FINAL.has(run.status)) {
      if (!options.json) ctx.out(renderCompletion(await ctx.client.runs.detail.query({ runId })));
      return run.status === "completed" ? 0 : 1;
    }
    if (options.timeoutMs !== undefined && elapsed >= options.timeoutMs) {
      ctx.err(`timed out after ${formatDuration(elapsed)}; ${run.id} is still ${run.status} at stage ${run.stage}`);
      return 2;
    }
    await ctx.sleep(options.intervalMs);
  }
}

export interface ScanOptions {
  kind?: Run["target"]["kind"];
  watch?: boolean;
  intervalMs: number;
  timeoutMs?: number;
  json?: boolean;
}

export async function scanCommand(ctx: CommandContext, input: string, options: ScanOptions): Promise<number> {
  const target = resolveScanTarget(input, { kind: options.kind, cwd: ctx.cwd, exists: ctx.exists });
  const run = await ctx.client.runs.create.mutate({ targetRef: target.ref, targetKind: target.kind, trigger: "manual" });
  // One JSON line, so `scan --json --watch` is a clean stream of JSON lines.
  if (options.json) ctx.out(JSON.stringify(run));
  else ctx.out(`Queued ${run.id} for ${targetLabel(run.target)}`);
  if (!options.watch) {
    if (!options.json) ctx.out(`Follow it with: repro watch ${run.id}`);
    return 0;
  }
  return watchCommand(ctx, run.id, { intervalMs: options.intervalMs, timeoutMs: options.timeoutMs, json: options.json });
}

export async function decideCommand(ctx: CommandContext, patchId: string, decision: "merge" | "reject"): Promise<number> {
  const patch = await ctx.client.patches.decide.mutate({ patchId, decision });
  ctx.out(`${patch.id} is now ${patch.status}`);
  return 0;
}

/** Runs a command, turning any error into one readable line on stderr and exit code 1. */
export async function guarded(ctx: CommandContext, command: () => Promise<number>): Promise<number> {
  try {
    return await command();
  } catch (error) {
    const code = apiErrorCode(error);
    ctx.err(`error: ${describeError(error, ctx.apiUrl)}${code && code !== "NOT_FOUND" && code !== "BAD_REQUEST" && code !== "CONFLICT" ? ` (${code})` : ""}`);
    return 1;
  }
}
