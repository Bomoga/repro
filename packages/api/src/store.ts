import { Run, Finding, Diagnosis, Patch } from "@repro/contracts";

export interface RunStore {
  createRun(run: Run): Promise<void>;
  getRun(id: string): Promise<Run | null>;
  listRuns(limit?: number, offset?: number): Promise<Run[]>;
  updateRunStatus(id: string, status: Run["status"]): Promise<void>;
  updateRunStage(id: string, stage: Run["stage"]): Promise<void>;
  
  createFinding(finding: Finding): Promise<void>;
  getFinding(id: string): Promise<Finding | null>;
  listFindings(runId: string): Promise<Finding[]>;
  updateFinding(id: string, partial: Partial<Finding>): Promise<void>;
  
  createDiagnosis(diagnosis: Diagnosis): Promise<void>;
  getDiagnosis(id: string): Promise<Diagnosis | null>;
  listDiagnoses(runId: string): Promise<Diagnosis[]>;
  
  createPatch(patch: Patch): Promise<void>;
  getPatch(id: string): Promise<Patch | null>;
  listPatches(runId: string): Promise<Patch[]>;
  updatePatch(id: string, partial: Partial<Patch>): Promise<void>;
}

export class InMemoryRunStore implements RunStore {
  private runs = new Map<string, Run>();
  private findings = new Map<string, Finding>();
  private diagnoses = new Map<string, Diagnosis>();
  private patches = new Map<string, Patch>();
  
  async createRun(run: Run): Promise<void> {
    this.runs.set(run.id, run);
  }
  
  async getRun(id: string): Promise<Run | null> {
    return this.runs.get(id) ?? null;
  }
  
  async listRuns(limit = 10, offset = 0): Promise<Run[]> {
    const runs = Array.from(this.runs.values());
    return runs.slice(offset, offset + limit);
  }
  
  async updateRunStatus(id: string, status: Run["status"]): Promise<void> {
    const run = this.runs.get(id);
    if (run) {
      run.status = status;
    }
  }
  
  async updateRunStage(id: string, stage: Run["stage"]): Promise<void> {
    const run = this.runs.get(id);
    if (run) {
      run.stage = stage;
    }
  }
  
  async createFinding(finding: Finding): Promise<void> {
    this.findings.set(finding.id, finding);
  }
  
  async getFinding(id: string): Promise<Finding | null> {
    return this.findings.get(id) ?? null;
  }
  
  async listFindings(runId: string): Promise<Finding[]> {
    // Note: In-memory store doesn't track runId association
    return Array.from(this.findings.values());
  }
  
  async updateFinding(id: string, partial: Partial<Finding>): Promise<void> {
    const finding = this.findings.get(id);
    if (finding) {
      Object.assign(finding, partial);
    }
  }
  
  async createDiagnosis(diagnosis: Diagnosis): Promise<void> {
    this.diagnoses.set(diagnosis.id, diagnosis);
  }
  
  async getDiagnosis(id: string): Promise<Diagnosis | null> {
    return this.diagnoses.get(id) ?? null;
  }
  
  async listDiagnoses(runId: string): Promise<Diagnosis[]> {
    return Array.from(this.diagnoses.values());
  }
  
  async createPatch(patch: Patch): Promise<void> {
    this.patches.set(patch.id, patch);
  }
  
  async getPatch(id: string): Promise<Patch | null> {
    return this.patches.get(id) ?? null;
  }
  
  async listPatches(runId: string): Promise<Patch[]> {
    return Array.from(this.patches.values());
  }
  
  async updatePatch(id: string, partial: Partial<Patch>): Promise<void> {
    const patch = this.patches.get(id);
    if (patch) {
      Object.assign(patch, partial);
    }
  }
}
