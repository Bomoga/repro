import type { ReproClient } from "../client.js";

export interface StatusOutput {
  write(line: string): void;
}

const consoleOutput: StatusOutput = { write: (line) => console.log(line) };

export async function statusCommand(client: ReproClient, runId?: string, out: StatusOutput = consoleOutput): Promise<void> {
  if (!runId) {
    const runs = await client.runs.list.query({ limit: 20 });
    if (runs.length === 0) {
      out.write("no runs yet");
      return;
    }
    for (const run of runs) {
      out.write(`${run.id}  ${run.stage.padEnd(8)} ${run.status.padEnd(10)} ${run.target.kind}:${run.target.ref}  ${run.startedAt}`);
    }
    return;
  }

  const run = await client.runs.get.query({ id: runId });
  if (!run) {
    out.write(`run not found: ${runId}`);
    return;
  }
  const [findings, diagnoses, patches] = await Promise.all([
    client.runs.findings.query({ runId }),
    client.runs.diagnoses.query({ runId }),
    client.runs.patches.query({ runId }),
  ]);

  out.write(`run       ${run.id}`);
  out.write(`target    ${run.target.kind}:${run.target.ref}`);
  out.write(`trigger   ${run.trigger}`);
  out.write(`stage     ${run.stage}`);
  out.write(`status    ${run.status}`);
  out.write(`started   ${run.startedAt}`);
  out.write(`findings  ${findings.length}`);
  out.write(`diagnoses ${diagnoses.length}`);
  out.write(`patches   ${patches.length} (${patches.filter((p) => p.status === "merged").length} merged)`);
}
