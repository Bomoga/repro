import { posix } from "node:path";
import { type DetectorAdapter, type Executor, type Finding, Severity, type Workspace } from "@repro/contracts";
import { DetectorError, findingId, readEvidence, shq } from "../util.ts";

// Lockfiles osv-scanner can read for the target ecosystems (npm, PyPI), recognized by name.
// Requirements files count, but repro-osv only reports their exact (==) pins.
const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "pdm.lock",
  "uv.lock",
  "Pipfile.lock",
]);
const REQUIREMENTS = /^requirements[\w.-]*\.txt$|\.requirements\.txt$|^constraints[\w.-]*\.txt$/;

// Lockfiles in the ingest-time file index, so Detect never re-walks the tree. Vendored copies
// under node_modules/ describe someone else's dependencies, not this project's.
export function lockfilesIn(fileIndex: readonly string[]): string[] {
  return fileIndex.filter((file) => {
    if (file.startsWith("-") || file.includes(":") || file.split("/").includes("node_modules")) return false;
    const base = posix.basename(file);
    return LOCKFILE_NAMES.has(base) || REQUIREMENTS.test(base);
  });
}

// One entry per (lockfile, package version, advisory), as printed by `repro-osv scan`.
export interface OsvHit {
  file: string;
  ecosystem: string;
  package: string;
  version: string;
  id: string;
  aliases: string[];
  cve: string | null;
  summary: string;
  severity: string;
  fixed: string[];
  lineStart: number;
  lineEnd: number;
}

export function parseOsvHits(stdout: string, workspace: Workspace, createdAt = new Date().toISOString()): Finding[] {
  let hits: OsvHit[];
  try {
    hits = JSON.parse(stdout);
  } catch {
    throw new DetectorError(`repro-osv produced an unreadable report: ${stdout.slice(0, 500)}`);
  }
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const hit of hits) {
    const id = findingId({
      runId: workspace.runId,
      detectorId: "osv-scanner",
      ruleId: hit.id,
      file: hit.file,
      span: `${hit.lineStart}-${hit.lineEnd}:${hit.package}@${hit.version}`,
    });
    if (seen.has(id)) continue;
    seen.add(id);

    const also = hit.cve && hit.cve !== hit.id ? ` / ${hit.cve}` : "";
    const fixed = hit.fixed.length ? ` Fixed in ${hit.fixed.join(", ")}.` : "";
    const summary = hit.summary ? `: ${hit.summary.replace(/\.$/, "")}` : "";
    const severity = Severity.safeParse(hit.severity);
    findings.push({
      id,
      detectorId: "osv-scanner",
      ruleId: hit.id,
      // repro-osv maps the advisory's own CVSS score (or its database label) onto the contract's
      // scale; nothing is re-ranked here.
      severity: severity.success ? severity.data : "medium",
      category: "vulnerability",
      file: hit.file,
      lineStart: hit.lineStart,
      lineEnd: hit.lineEnd,
      message: `${hit.package}@${hit.version} (${hit.ecosystem}) has a known vulnerability, ${hit.id}${also}${summary}.${fixed}`,
      evidence: readEvidence(workspace.path, hit.file, hit.lineStart, hit.lineEnd),
      reproducible: false,
      reproductionCommand: `repro-osv check ${shq(hit.file)} ${shq(hit.package)} ${shq(hit.id)}`,
      createdAt,
    });
  }
  return findings;
}

// Known-vulnerable dependency versions: osv-scanner in offline mode against the OSV database
// snapshot baked into the sandbox image (sandbox/Dockerfile). Deterministic for a given lockfile
// and image, and the reproductionCommand is the same check narrowed to one package and advisory,
// so upgrading the pin is exactly what makes it stop reproducing.
export const osvAdapter: DetectorAdapter = {
  id: "osv-scanner",
  async run(workspace: Workspace, exec: Executor): Promise<Finding[]> {
    const lockfiles = lockfilesIn(workspace.fileIndex);
    if (lockfiles.length === 0) return [];
    const result = await exec.exec({
      workspacePath: workspace.path,
      command: `repro-osv scan ${lockfiles.map(shq).join(" ")}`,
      timeoutMs: 10 * 60_000,
    });
    if (result.timedOut || result.exitCode !== 0) {
      throw new DetectorError(
        `osv-scanner failed (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}): ${result.stderr.slice(0, 2000)}`,
      );
    }
    return parseOsvHits(result.stdout, workspace);
  },
};
