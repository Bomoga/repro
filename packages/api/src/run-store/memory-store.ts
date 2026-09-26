import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import { RunNotFoundError, type RunStore } from "./store.js";

/** In-memory Run Store: what unit tests and local `npm run dev` use with no Mongo running. */
export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, Run>();
  private readonly findings = new Map<string, Finding[]>();
  private readonly diagnoses = new Map<string, Diagnosis[]>();
  private readonly patches = new Map<string, Patch[]>();

  async createRun(run: Run): Promise<Run> {
    this.runs.set(run.id, run);
    return run;
  }

  async getRun(id: string): Promise<Run | null> {
    return this.runs.get(id) ?? null;
  }

  async listRuns(opts?: { limit?: number }): Promise<Run[]> {
    const all = [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return opts?.limit ? all.slice(0, opts.limit) : all;
  }

  async updateRun(id: string, patch: Partial<Omit<Run, "id">>): Promise<Run | null> {
    const existing = this.runs.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this.runs.set(id, updated);
    return updated;
  }

  async addFindings(runId: string, findings: Finding[]): Promise<void> {
    this.requireRun(runId);
    this.findings.set(runId, [...(this.findings.get(runId) ?? []), ...findings]);
  }

  async listFindings(runId: string): Promise<Finding[]> {
    return this.findings.get(runId) ?? [];
  }

  async addDiagnoses(runId: string, diagnoses: Diagnosis[]): Promise<void> {
    this.requireRun(runId);
    this.diagnoses.set(runId, [...(this.diagnoses.get(runId) ?? []), ...diagnoses]);
  }

  async listDiagnoses(runId: string): Promise<Diagnosis[]> {
    return this.diagnoses.get(runId) ?? [];
  }

  async addPatch(runId: string, patch: Patch): Promise<void> {
    this.requireRun(runId);
    this.patches.set(runId, [...(this.patches.get(runId) ?? []), patch]);
  }

  async listPatches(runId: string): Promise<Patch[]> {
    return this.patches.get(runId) ?? [];
  }

  async updatePatch(runId: string, patchId: string, patch: Partial<Omit<Patch, "id">>): Promise<Patch | null> {
    const list = this.patches.get(runId);
    if (!list) return null;
    const index = list.findIndex((p) => p.id === patchId);
    if (index === -1) return null;
    const existing = list[index];
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    list[index] = updated;
    return updated;
  }

  private requireRun(runId: string): void {
    if (!this.runs.has(runId)) throw new RunNotFoundError(runId);
  }
}
