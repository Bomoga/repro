import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import {
  applyRunUpdate,
  assertDiagnosesInsertable,
  assertFindingsInsertable,
  assertPatchWritable,
  assertReproductionRecordable,
  assertRunConsistent,
  buildNewRun,
  decidedPatch,
  emptyCounts,
  isVerifiedStatus,
  notFound,
  reproducedFinding,
} from "./invariants.ts";
import {
  DEFAULT_RUN_LIMIT,
  StoreError,
  type FindingQuery,
  type NewRun,
  type OpenPullRequest,
  type PatchDecision,
  type RunCounts,
  type RunLogRecord,
  type RunQuery,
  type RunStore,
  type RunUpdate,
} from "./types.ts";

interface RunRecord {
  run: Run;
  findings: Finding[];
  diagnoses: Diagnosis[];
  patches: Patch[];
  logs: RunLogRecord[];
}

// Every value crossing the store boundary is copied, so callers can't mutate stored state through
// a returned object (or keep mutating an object after writing it), the same as with Mongo.
const copy = <T>(value: T): T => structuredClone(value);

export function compareRunsNewestFirst(a: Run, b: Run): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The store used when MONGODB_URI is unset: development, demos without Atlas, and tests. */
export class InMemoryRunStore implements RunStore {
  readonly kind = "memory" as const;

  private readonly runs = new Map<string, RunRecord>();
  // Which run owns each Finding, Diagnosis, and Patch ID. IDs are unique store-wide, as in Mongo.
  private readonly findingRun = new Map<string, string>();
  private readonly diagnosisRun = new Map<string, string>();
  private readonly patchRun = new Map<string, string>();

  async listRuns(query: RunQuery = {}): Promise<Run[]> {
    const offset = query.offset ?? 0;
    const limit = Math.max(0, query.limit ?? DEFAULT_RUN_LIMIT);
    return [...this.runs.values()]
      .map((record) => record.run)
      .filter((run) => !query.status || run.status === query.status)
      .sort(compareRunsNewestFirst)
      .slice(offset, offset + limit)
      .map(copy);
  }

  async getRun(runId: string): Promise<Run | null> {
    const record = this.runs.get(runId);
    return record ? copy(record.run) : null;
  }

  async countRuns(runIds: string[]): Promise<Record<string, RunCounts>> {
    const counts: Record<string, RunCounts> = {};
    for (const runId of runIds) {
      const record = this.runs.get(runId);
      const tally = emptyCounts();
      if (record) {
        tally.findings = record.findings.length;
        tally.reproducible = record.findings.filter((f) => f.reproducible).length;
        tally.diagnoses = record.diagnoses.length;
        tally.patches = record.patches.length;
        tally.verifiedPatches = record.patches.filter((p) => isVerifiedStatus(p.status)).length;
      }
      counts[runId] = tally;
    }
    return counts;
  }

  async listFindings(runId: string, query: FindingQuery = {}): Promise<Finding[]> {
    const findings = this.runs.get(runId)?.findings ?? [];
    return findings.filter((f) => query.reproducible === undefined || f.reproducible === query.reproducible).map(copy);
  }

  async getFinding(findingId: string): Promise<Finding | null> {
    const found = this.findFinding(findingId);
    return found ? copy(found.finding) : null;
  }

  async listDiagnoses(runId: string): Promise<Diagnosis[]> {
    return (this.runs.get(runId)?.diagnoses ?? []).map(copy);
  }

  async getDiagnosis(diagnosisId: string): Promise<Diagnosis | null> {
    const runId = this.diagnosisRun.get(diagnosisId);
    const diagnosis = runId ? this.runs.get(runId)?.diagnoses.find((d) => d.id === diagnosisId) : undefined;
    return diagnosis ? copy(diagnosis) : null;
  }

  async listPatches(runId: string): Promise<Patch[]> {
    return (this.runs.get(runId)?.patches ?? []).map(copy);
  }

  async getPatch(patchId: string): Promise<Patch | null> {
    const found = this.findPatch(patchId);
    return found ? copy(found.record.patches[found.index]!) : null;
  }

  async createRun(input: NewRun): Promise<Run> {
    return this.insertRun(buildNewRun(input));
  }

  async insertRun(run: Run): Promise<Run> {
    assertRunConsistent(run);
    if (this.runs.has(run.id)) throw new StoreError("CONFLICT", `run ${run.id} already exists`);
    this.runs.set(run.id, { run: copy(run), findings: [], diagnoses: [], patches: [], logs: [] });
    return copy(run);
  }

  async updateRun(runId: string, update: RunUpdate): Promise<Run> {
    const record = this.requireRun(runId);
    record.run = applyRunUpdate(record.run, update);
    return copy(record.run);
  }

  async addFindings(runId: string, findings: Finding[]): Promise<void> {
    const record = this.requireRun(runId);
    assertFindingsInsertable(runId, findings);
    for (const finding of findings) {
      if (this.findingRun.has(finding.id)) throw new StoreError("CONFLICT", `finding ${finding.id} already exists`);
    }
    for (const finding of findings) {
      record.findings.push(copy(finding));
      this.findingRun.set(finding.id, runId);
    }
  }

  async recordReproduction(findingId: string, reproductionOutput?: string): Promise<Finding> {
    const found = this.findFinding(findingId);
    if (!found) throw notFound("finding", findingId);
    assertReproductionRecordable(found.finding);
    const next = reproducedFinding(found.finding, reproductionOutput);
    found.record.findings[found.index] = next;
    return copy(next);
  }

  async addDiagnoses(runId: string, diagnoses: Diagnosis[]): Promise<void> {
    const record = this.requireRun(runId);
    assertDiagnosesInsertable(runId, diagnoses, new Set(record.findings.map((f) => f.id)));
    for (const diagnosis of diagnoses) {
      if (this.diagnosisRun.has(diagnosis.id)) throw new StoreError("CONFLICT", `diagnosis ${diagnosis.id} already exists`);
    }
    for (const diagnosis of diagnoses) {
      record.diagnoses.push(copy(diagnosis));
      this.diagnosisRun.set(diagnosis.id, runId);
    }
  }

  async savePatch(runId: string, patch: Patch): Promise<Patch> {
    const record = this.requireRun(runId);
    const found = this.findPatch(patch.id);
    const existing = found ? { runId: found.runId, patch: found.record.patches[found.index]! } : null;
    assertPatchWritable(runId, patch, existing, new Set(record.diagnoses.map((d) => d.id)));
    if (found) {
      found.record.patches[found.index] = copy(patch);
    } else {
      record.patches.push(copy(patch));
      this.patchRun.set(patch.id, runId);
    }
    return copy(patch);
  }

  async setPatchDecision(patchId: string, decision: PatchDecision): Promise<Patch> {
    const found = this.findPatch(patchId);
    if (!found) throw notFound("patch", patchId);
    const next = decidedPatch(found.record.patches[found.index]!, decision);
    found.record.patches[found.index] = next;
    return copy(next);
  }

  async listOpenPullRequests(): Promise<OpenPullRequest[]> {
    return [...this.runs].flatMap(([runId, record]) =>
      record.patches.filter((patch) => patch.status === "verified" && patch.prUrl).map((patch) => ({ runId, patch: copy(patch) })),
    );
  }

  async claimNextQueued(): Promise<Run | null> {
    const oldestFirst = (a: RunRecord, b: RunRecord) =>
      a.run.startedAt !== b.run.startedAt ? (a.run.startedAt < b.run.startedAt ? -1 : 1) : a.run.id < b.run.id ? -1 : 1;
    const next = [...this.runs.values()].filter((record) => record.run.status === "queued").sort(oldestFirst)[0];
    if (!next) return null;
    next.run = { ...next.run, status: "running" };
    return copy(next.run);
  }

  async appendLog(runId: string, kind: string, entry: unknown, at?: string): Promise<void> {
    this.requireRun(runId).logs.push(copy({ at: at ?? new Date().toISOString(), kind, entry }));
  }

  async listLogs(runId: string, query: { kind?: string } = {}): Promise<RunLogRecord[]> {
    const logs = this.runs.get(runId)?.logs ?? [];
    return logs.filter((record) => query.kind === undefined || record.kind === query.kind).map(copy);
  }

  async ping(): Promise<void> {}

  async close(): Promise<void> {}

  private requireRun(runId: string): RunRecord {
    const record = this.runs.get(runId);
    if (!record) throw notFound("run", runId);
    return record;
  }

  private findFinding(findingId: string): { record: RunRecord; index: number; finding: Finding } | null {
    const runId = this.findingRun.get(findingId);
    const record = runId ? this.runs.get(runId) : undefined;
    if (!record) return null;
    const index = record.findings.findIndex((f) => f.id === findingId);
    return index === -1 ? null : { record, index, finding: record.findings[index]! };
  }

  private findPatch(patchId: string): { runId: string; record: RunRecord; index: number } | null {
    const runId = this.patchRun.get(patchId);
    const record = runId ? this.runs.get(runId) : undefined;
    if (!runId || !record) return null;
    const index = record.patches.findIndex((p) => p.id === patchId);
    return index === -1 ? null : { runId, record, index };
  }
}
