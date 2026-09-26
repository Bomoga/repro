import type { ReproClient } from "../client.js";
import type { StatusOutput } from "./status.js";

const consoleOutput: StatusOutput = { write: (line) => console.log(line) };

export interface ScanOptions {
  kind?: "local" | "github";
  trigger?: "manual" | "schedule" | "webhook";
}

/** Queues a new Run against `ref` and hands it to the (out-of-scope-for-Lane-4) Run
 *  Orchestrator; this command's job ends at making the queued Run visible. */
export async function scanCommand(client: ReproClient, ref: string, options: ScanOptions = {}, out: StatusOutput = consoleOutput) {
  const run = await client.runs.create.mutate({
    trigger: options.trigger ?? "manual",
    target: { kind: options.kind ?? "local", ref },
  });
  out.write(`queued run ${run.id} (${run.target.kind}:${run.target.ref})`);
  return run;
}
