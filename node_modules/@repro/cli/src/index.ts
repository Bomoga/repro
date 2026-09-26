#!/usr/bin/env node

import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@repro/api';

const apiBase = process.env.REPRO_API_URL ?? 'http://localhost:3001';
const client = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: `${apiBase}/trpc` })]
});

async function main() {
  const [command, requestedRunId] = process.argv.slice(2);

  if (command === 'status') {
    const runs = await client.runs.list.query({ limit: 10 });
    const runId = requestedRunId ?? runs[0]?.id;
    if (!runId) {
      console.log('No runs found in the Run Store.');
      return;
    }

    const details = await client.runs.get.query({ id: runId });
    console.log(`Run: ${details.run.id} (${details.run.status})`);
    console.log(`Stage: ${details.run.stage}`);
    console.log(`Findings: ${details.findings.length}`);
    console.log(`Reproducible: ${details.findings.filter((finding) => finding.reproducible).length}`);
    for (const patch of details.patches) {
      console.log(`Patch ${patch.id}: ${patch.status}; tests ${patch.testsPassed ? 'passed' : 'failed'}; challenger ${patch.challengerVerdict}`);
    }
    return;
  }

  console.log('Usage: repro status [run-id]');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
