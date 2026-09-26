import type { ReproClient } from "../client.js";
import type { StatusOutput } from "./status.js";

const consoleOutput: StatusOutput = { write: (line) => console.log(line) };
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export interface WatchOptions {
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Stops the loop even if the run never reaches a terminal status; mainly for tests. */
  maxIterations?: number;
}

/** Polls a run until it reaches a terminal status, printing a line only when stage or status
 *  actually changes so a long run doesn't spam identical lines every interval. */
export async function watchCommand(client: ReproClient, runId: string, options: WatchOptions = {}, out: StatusOutput = consoleOutput): Promise<void> {
  const intervalMs = options.intervalMs ?? 2000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxIterations = options.maxIterations ?? Infinity;

  let lastKey = "";
  for (let i = 0; i < maxIterations; i++) {
    const run = await client.runs.get.query({ id: runId });
    if (!run) {
      out.write(`run not found: ${runId}`);
      return;
    }
    const key = `${run.stage}:${run.status}`;
    if (key !== lastKey) {
      out.write(`[${new Date().toISOString()}] ${run.id} stage=${run.stage} status=${run.status}`);
      lastKey = key;
    }
    if (TERMINAL_STATUSES.has(run.status)) return;
    await sleep(intervalMs);
  }
}
