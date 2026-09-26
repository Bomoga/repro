// Lane 2 on its own: ingest a target, run every detector, reproduce each Finding in the sandbox.
// A dev tool for integration and the demo's "before" beat, not the product CLI (that's lane 4's
// `repro scan`).
//
//   npm run scan:lane2 -- /path/to/repo[#rev]
//   npm run scan:lane2 -- owner/repo[#rev]
//   npm run scan:lane2 -- owner/repo --json > findings.json
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { detect, reproduce } from "@repro/detect";
import { DockerExecutor, sandboxAvailable } from "@repro/executor";
import { ingest } from "@repro/ingest";

const args = process.argv.slice(2);
const json = args.includes("--json");
const ref = args.find((a) => !a.startsWith("--"));
if (!ref) {
  console.error("usage: npm run scan:lane2 -- <local-path|owner/repo>[#rev] [--json]");
  process.exit(2);
}
if (!(await sandboxAvailable())) {
  console.error("sandbox image repro-sandbox:dev not found; run `npm run sandbox:build` first");
  process.exit(2);
}

const log = (msg: string) => json || console.error(msg);
const kind = existsSync(ref.split("#")[0]!) ? "local" : "github";
const runId = `lane2-${randomUUID().slice(0, 8)}`;
const exec = new DockerExecutor();

const workspace = await ingest(runId, { kind, ref });
log(`ingested ${ref} @ ${workspace.headCommit.slice(0, 12)} (${workspace.fileIndex.length} files, ${workspace.languages.join(", ")})`);
log(`workspace: ${workspace.path}`);

const detected = await detect(workspace, exec);
for (const f of detected.failures) log(`detector ${f.detectorId} failed: ${f.message}`);
log(`detected ${detected.findings.length} findings; reproducing...`);

const { findings, attempts } = await reproduce(detected.findings, workspace, exec);
if (json) {
  console.log(JSON.stringify({ workspace, findings, attempts, failures: detected.failures }, null, 2));
} else {
  for (const f of findings) {
    const mark = f.reproducible ? "REPRODUCED" : "unconfirmed";
    console.log(`${mark.padEnd(11)} ${f.severity.padEnd(8)} ${f.detectorId.padEnd(16)} ${f.file}:${f.lineStart}  ${f.ruleId}`);
  }
  const confirmed = findings.filter((f) => f.reproducible).length;
  console.log(`\n${confirmed} of ${findings.length} findings reproduced in the sandbox`);
}
