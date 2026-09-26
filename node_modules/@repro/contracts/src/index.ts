export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type Stage = "ingest" | "detect" | "diagnose" | "repair" | "verify" | "done";
export type RunStatus = "queued" | "running" | "blocked" | "completed" | "failed";
export type Trigger = "manual" | "schedule" | "webhook";

export interface Finding {
  id: string;
  detectorId: string;
  ruleId: string;
  severity: Severity;
  category: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  message: string;
  evidence: string;
  reproducible: boolean;
  reproductionCommand?: string;
  reproductionOutput?: string;
  createdAt: string;
}

export interface Diagnosis {
  id: string;
  findingIds: string[];
  rootCause: string;
  proposedStrategy: string;
  riskNotes: string;
  model: string;
  createdAt: string;
}

export interface Patch {
  id: string;
  diagnosisId: string;
  diff: string;
  filesChanged: string[];
  testsPassed: boolean;
  originalFindingReproduces: boolean;
  reproductionOutputAfter?: string;
  regressionFindings: Finding[];
  challengerVerdict: "confirmed" | "disputed";
  challengerNotes?: string;
  status: "proposed" | "verified" | "rejected" | "merged";
  prUrl?: string;
}

export interface Run {
  id: string;
  trigger: Trigger;
  target: { kind: "local" | "github"; ref: string };
  stage: Stage;
  status: RunStatus;
  startedAt: string;
  logRef: string;
}

export interface Workspace {
  runId: string;
  path: string;
  fileIndex: string[];
  languages: string[];
  headCommit: string;
}

export interface ExecRequest {
  workspacePath: string;
  command: string;
  timeoutMs: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface DetectorAdapter {
  id: string;
  run(workspace: Workspace, exec: (request: ExecRequest) => Promise<ExecResult>): Promise<Finding[]>;
}

export const demoRun: Run = {
  id: "run-demo-001",
  trigger: "manual",
  target: { kind: "local", ref: "." },
  stage: "verify",
  status: "running",
  startedAt: new Date().toISOString(),
  logRef: "logs/demo-run-001.json"
};

export const demoFindings: Finding[] = [
  {
    id: "finding-1",
    detectorId: "semgrep",
    ruleId: "no-unsafe-eval",
    severity: "high",
    category: "correctness",
    file: "src/auth.ts",
    lineStart: 17,
    lineEnd: 21,
    message: "Unsafe eval used to parse user input.",
    evidence: "const token = eval(userInput);",
    reproducible: true,
    reproductionCommand: "npm test -- --runInBand auth",
    reproductionOutput: "FAIL: auth.spec.ts - token parsing should reject invalid JSON",
    createdAt: new Date().toISOString()
  }
];
