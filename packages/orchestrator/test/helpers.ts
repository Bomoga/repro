import { vi } from "vitest";
import {
  createGeminiClient,
  type GeminiClient,
  type InteractionLog,
  type InteractionsSdk,
  type RepairAndVerifyDeps,
  type RepairAndVerifyResult,
  type RequestBudget,
} from "@repro/agents";
import { InMemoryRunStore } from "@repro/api";
import type { Diagnosis, Finding, Patch, Run, Workspace } from "@repro/contracts";
import type { PipelineDeps, Stages } from "../src/pipeline.ts";

export const HEAD = "0123456789abcdef0123456789abcdef01234567";
const at = "2026-09-26T10:00:00.000Z";

export function aWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return { runId: "run_x", path: "/workspaces/run_x/repo", fileIndex: ["src/db.js"], languages: ["javascript"], headCommit: HEAD, ...overrides };
}

export function aFinding(id: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    detectorId: "semgrep",
    ruleId: "javascript.lang.security.audit.sqli.node-postgres-sqli",
    severity: "high",
    category: "vulnerability",
    file: "src/db.js",
    lineStart: 6,
    lineEnd: 7,
    message: "SQL built by string concatenation",
    evidence: "const sql = 'SELECT * FROM notes WHERE id = ' + id;",
    reproducible: false,
    reproductionCommand: "repro-semgrep-rule registry sqli src/db.js",
    createdAt: at,
    ...overrides,
  };
}

export function aDiagnosis(id: string, findingIds: string[]): Diagnosis {
  return {
    id,
    findingIds,
    rootCause: "Caller-supplied values are concatenated into SQL",
    proposedStrategy: "Use bound parameters",
    riskNotes: "Other users' rows are readable",
    model: "gemini-3.1-pro-preview",
    createdAt: at,
  };
}

export function aPatch(id: string, diagnosisId: string, overrides: Partial<Patch> = {}): Patch {
  return {
    id,
    diagnosisId,
    diff: "diff --git a/src/db.js b/src/db.js\n--- a/src/db.js\n+++ b/src/db.js\n@@ -6 +6 @@\n-const sql = 'SELECT * FROM notes WHERE id = ' + id;\n+const sql = 'SELECT * FROM notes WHERE id = $1';\n",
    filesChanged: ["src/db.js"],
    testsPassed: true,
    originalFindingReproduces: false,
    reproductionOutputAfter: "NOT REPRODUCED semgrep sqli in src/db.js",
    regressionFindings: [],
    challengerVerdict: "disputed",
    challengerNotes: "Not yet challenged.",
    status: "proposed",
    ...overrides,
  };
}

/** A Gemini client that answers every request with `outputText` and records it to the Run's log,
 *  the way Lane 3's wrapper does. */
export function fakeGemini(outputText = "{}"): (log: InteractionLog) => GeminiClient {
  return (log) => ({
    async interact(request) {
      const response = { interactionId: "i1", model: "gemini-3.8-flash", status: "completed", outputText, functionCalls: [] };
      log.record({ at, role: request.role, model: response.model, attempt: 1, durationMs: 1, request: { systemInstruction: request.systemInstruction, input: request.input }, response });
      return response;
    },
  });
}

/** Lane 3's real wrapper over an SDK that answers every request at once, so the Run's budget counts
 *  and caps requests exactly as it would against the API. Every role is on section 10's default model. */
export function sdkBackedGemini(): (log: InteractionLog, budget: RequestBudget) => GeminiClient {
  const sdk: InteractionsSdk = {
    interactions: {
      create: async (params) => ({ id: "i1", model: params.model, status: "completed", output_text: "{}", steps: [] }),
      get: async () => Promise.reject(new Error("no background interactions here")),
    },
  };
  return (log, budget) => createGeminiClient({ log, budget, sdk, env: {}, sleep: async () => {} });
}

/** A repair that spends `challengerRequests` Pro-tier requests (or keeps going until the budget stops
 *  it), then ends like the demo's: disputed once, then verified. */
export function spendingRepair(challengerRequests: number | "until-spent") {
  return async (input: { diagnosis: Diagnosis }, deps: RepairAndVerifyDeps): Promise<RepairAndVerifyResult> => {
    for (let i = 0; challengerRequests === "until-spent" || i < challengerRequests; i++) {
      await deps.gemini.interact({ role: "challenger", systemInstruction: "challenge", input: `attack ${i}` });
    }
    return disputedThenVerified(input, deps);
  };
}

/**
 * The demo's repair (beat 5): attempt 1 is disputed by a counter-test and rejected, attempt 2 is
 * verified. Reports progress and tool calls exactly the way Lane 3's repairAndVerify does.
 */
export async function disputedThenVerified(input: { diagnosis: Diagnosis }, deps: RepairAndVerifyDeps): Promise<RepairAndVerifyResult> {
  const { diagnosis } = input;
  await deps.onProgress?.({ type: "repairing", attempt: 1 });
  deps.onToolCall?.({ name: "read_file", arguments: { path: "src/db.js" }, ok: true, summary: "read src/db.js (12 lines)" });
  const first = aPatch(`${diagnosis.id}_patch_1`, diagnosis.id);
  await deps.onProgress?.({ type: "challenging", attempt: 1, patch: first });
  const result = { exitCode: 1, stdout: "", stderr: "", timedOut: false, durationMs: 5 };
  const test = { path: "test/repro-counter-1.test.js", code: "...", command: "node test/repro-counter-1.test.js", description: "numeric injection" };
  deps.onCounterTest?.({ test, before: { status: "fail", result }, after: { status: "fail", result }, outcome: "hole-open" });
  const rejected = { ...first, challengerNotes: "The counter-test still fails.", status: "rejected" as const };
  await deps.onProgress?.({ type: "attempt-finished", attempt: 1, patch: rejected });

  await deps.onProgress?.({ type: "repairing", attempt: 2 });
  const second = aPatch(`${diagnosis.id}_patch_2`, diagnosis.id);
  await deps.onProgress?.({ type: "challenging", attempt: 2, patch: second });
  const verified = { ...second, challengerVerdict: "confirmed" as const, challengerNotes: "Counter-test failed before, passes after.", status: "verified" as const };
  await deps.onProgress?.({ type: "attempt-finished", attempt: 2, patch: verified });
  return { patch: verified, attempts: [] };
}

export interface Harness {
  store: InMemoryRunStore;
  deps: PipelineDeps & { stages: Stages };
  /** Every stage/status the Run moved through, in order. */
  moves: string[];
  lines: string[];
  queue(): Promise<Run>;
}

/** A pipeline over the real in-memory store, with every stage faked: two findings, one of which
 *  reproduces; two diagnoses, one of which cites only the reproduced finding. */
export function harness(): Harness {
  const store = new InMemoryRunStore();
  const moves: string[] = [];
  const updateRun = store.updateRun.bind(store);
  store.updateRun = async (runId, update) => {
    const run = await updateRun(runId, update);
    moves.push(`${run.stage}/${run.status}`);
    return run;
  };
  const lines: string[] = [];
  const stages: Stages = {
    ingest: vi.fn(async (runId: string) => aWorkspace({ runId })),
    removeWorkspace: vi.fn(),
    detect: vi.fn(async () => ({
      findings: [aFinding("fnd_sqli"), aFinding("fnd_style", { ruleId: "style.rule", reproductionCommand: undefined })],
      failures: [{ detectorId: "osv-scanner", message: "osv-scanner exited 2" }],
      droppedOutsideIndex: 0,
    })),
    reproduce: vi.fn(async (findings: Finding[]) => ({
      findings: findings.map((f) => (f.id === "fnd_sqli" ? { ...f, reproducible: true, reproductionOutput: "REPRODUCED semgrep sqli at src/db.js:6-7" } : f)),
      attempts: findings.map((f) => ({ findingId: f.id, outcome: f.id === "fnd_sqli" ? ("reproduced" as const) : ("no-command" as const) })),
    })),
    diagnose: vi.fn(async (_input, { gemini }) => {
      await gemini.interact({ role: "diagnose", systemInstruction: "diagnose", input: "findings" });
      return { diagnoses: [aDiagnosis("diag_sqli", ["fnd_sqli"]), aDiagnosis("diag_style", ["fnd_style"])], dropped: [], uncoveredFindingIds: [], attempts: 1 };
    }),
    repairAndVerify: vi.fn(disputedThenVerified),
  };
  return {
    store,
    moves,
    lines,
    deps: { store, executor: { exec: vi.fn() }, gemini: fakeGemini(), detectors: [], stages, say: (line) => lines.push(line) },
    async queue() {
      await store.createRun({ target: { kind: "github", ref: "octo/example" }, trigger: "manual" });
      return (await store.claimNextQueued())!;
    },
  };
}
