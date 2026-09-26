import { describe, expect, expectTypeOf, it } from "vitest";
import * as z from "zod";
import {
  DiagnosisSchema,
  ExecRequestSchema,
  ExecResultSchema,
  FindingSchema,
  KNOWN_CATEGORIES,
  PatchSchema,
  RunSchema,
  WorkspaceSchema,
  type DetectorAdapter,
  type Diagnosis,
  type ExecRequest,
  type ExecResult,
  type Executor,
  type Finding,
  type Patch,
  type Run,
  type Workspace,
} from "../src/index.ts";

// Section 4's interfaces, transcribed verbatim (minus the two pending fields, which are not
// adopted). The inferred contract types must equal these exactly; `npm run build` type-checks it.
namespace Section4 {
  export interface Finding {
    id: string;
    detectorId: string;
    ruleId: string;
    severity: "info" | "low" | "medium" | "high" | "critical";
    category: "vulnerability" | "inefficiency" | "correctness" | "style" | string;
    file: string;
    lineStart: number;
    lineEnd: number;
    message: string;
    evidence: string;
    reproducible: boolean;
    reproductionCommand?: string;
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
    regressionFindings: Finding[];
    challengerVerdict: "confirmed" | "disputed";
    challengerNotes?: string;
    status: "proposed" | "verified" | "rejected" | "merged";
    prUrl?: string;
  }
  export interface Run {
    id: string;
    trigger: "manual" | "schedule" | "webhook";
    target: { kind: "local" | "github"; ref: string };
    stage: "ingest" | "detect" | "diagnose" | "repair" | "verify" | "done";
    status: "queued" | "running" | "blocked" | "completed" | "failed";
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
}

const finding: Finding = {
  id: "fnd_1",
  detectorId: "semgrep",
  ruleId: "javascript.express.security.audit.xss.direct-response-write",
  severity: "high",
  category: "vulnerability",
  file: "server/index.js",
  lineStart: 12,
  lineEnd: 12,
  message: "User input written directly to the response",
  evidence: "res.send(req.query.name);",
  reproducible: false,
  reproductionCommand: "semgrep --config rules/xss.yml server/index.js",
  createdAt: "2026-09-26T12:00:00.000Z",
};

const diagnosis: Diagnosis = {
  id: "dgn_1",
  findingIds: ["fnd_1"],
  rootCause: "Request input reaches res.send without escaping",
  proposedStrategy: "Escape the value before writing it to the response",
  riskNotes: "Pages that render trusted HTML through the same path need a check",
  model: "gemini-3.1-pro-preview",
  createdAt: "2026-09-26T12:01:00.000Z",
};

const patch: Patch = {
  id: "pch_1",
  diagnosisId: "dgn_1",
  diff: "diff --git a/server/index.js b/server/index.js\n",
  filesChanged: ["server/index.js"],
  testsPassed: true,
  originalFindingReproduces: false,
  regressionFindings: [],
  challengerVerdict: "confirmed",
  challengerNotes: "Counter-test failed before the patch and passes after",
  status: "proposed",
};

const run: Run = {
  id: "run_1",
  trigger: "manual",
  target: { kind: "github", ref: "Bomoga/demo-target@main" },
  stage: "detect",
  status: "running",
  startedAt: "2026-09-26T11:59:00.000Z",
  logRef: "runs/run_1/log",
};

const workspace: Workspace = {
  runId: "run_1",
  path: "/workspaces/run_1",
  fileIndex: ["server/index.js", "app/jobs.py"],
  languages: ["javascript", "python"],
  headCommit: "8d2ee68a1f0c",
};

const execRequest: ExecRequest = { workspacePath: "/workspaces/run_1", command: "npm test", timeoutMs: 60_000 };

const execResult: ExecResult = { exitCode: 1, stdout: "", stderr: "1 failing", timedOut: false, durationMs: 812 };

const keys = (schema: z.ZodObject) => Object.keys(schema.shape).sort();

describe("inferred types", () => {
  it("equal section 4's interfaces exactly", () => {
    expectTypeOf<Finding>().toEqualTypeOf<Section4.Finding>();
    expectTypeOf<Diagnosis>().toEqualTypeOf<Section4.Diagnosis>();
    expectTypeOf<Patch>().toEqualTypeOf<Section4.Patch>();
    expectTypeOf<Run>().toEqualTypeOf<Section4.Run>();
    expectTypeOf<Workspace>().toEqualTypeOf<Section4.Workspace>();
    expectTypeOf<ExecRequest>().toEqualTypeOf<Section4.ExecRequest>();
    expectTypeOf<ExecResult>().toEqualTypeOf<Section4.ExecResult>();
  });

  it("give Executor and DetectorAdapter section 4's call shapes", () => {
    expectTypeOf<Executor["exec"]>().toEqualTypeOf<(request: ExecRequest) => Promise<ExecResult>>();
    expectTypeOf<DetectorAdapter["run"]>().toEqualTypeOf<
      (workspace: Workspace, exec: Executor) => Promise<Finding[]>
    >();

    const executor: Executor = { exec: async () => execResult };
    const adapter: DetectorAdapter = {
      id: "semgrep",
      run: async (ws, exec) => {
        await exec.exec({ workspacePath: ws.path, command: "semgrep --json .", timeoutMs: 1_000 });
        return [finding];
      },
    };
    return expect(adapter.run(workspace, executor)).resolves.toEqual([finding]);
  });
});

describe("schemas", () => {
  it("round-trip a valid object of every contract", () => {
    expect(FindingSchema.parse(finding)).toEqual(finding);
    expect(DiagnosisSchema.parse(diagnosis)).toEqual(diagnosis);
    expect(PatchSchema.parse(patch)).toEqual(patch);
    expect(RunSchema.parse(run)).toEqual(run);
    expect(WorkspaceSchema.parse(workspace)).toEqual(workspace);
    expect(ExecRequestSchema.parse(execRequest)).toEqual(execRequest);
    expect(ExecResultSchema.parse(execResult)).toEqual(execResult);
  });

  it("carry exactly section 4's fields", () => {
    expect(keys(FindingSchema)).toEqual(
      [
        "id", "detectorId", "ruleId", "severity", "category", "file", "lineStart", "lineEnd",
        "message", "evidence", "reproducible", "reproductionCommand", "createdAt",
      ].sort(),
    );
    expect(keys(DiagnosisSchema)).toEqual(
      ["id", "findingIds", "rootCause", "proposedStrategy", "riskNotes", "model", "createdAt"].sort(),
    );
    expect(keys(PatchSchema)).toEqual(
      [
        "id", "diagnosisId", "diff", "filesChanged", "testsPassed", "originalFindingReproduces",
        "regressionFindings", "challengerVerdict", "challengerNotes", "status", "prUrl",
      ].sort(),
    );
    expect(keys(RunSchema)).toEqual(["id", "trigger", "target", "stage", "status", "startedAt", "logRef"].sort());
    expect(keys(WorkspaceSchema)).toEqual(["runId", "path", "fileIndex", "languages", "headCommit"].sort());
    expect(keys(ExecRequestSchema)).toEqual(["workspacePath", "command", "timeoutMs"].sort());
    expect(keys(ExecResultSchema)).toEqual(["exitCode", "stdout", "stderr", "timedOut", "durationMs"].sort());
  });

  it("do not adopt the pending proof fields", () => {
    expect(FindingSchema.shape).not.toHaveProperty("reproductionOutput");
    expect(PatchSchema.shape).not.toHaveProperty("reproductionOutputAfter");
    const parsedFinding = FindingSchema.parse({ ...finding, reproducible: true, reproductionOutput: "REPRODUCED" });
    expect(parsedFinding).not.toHaveProperty("reproductionOutput");
    const parsedPatch = PatchSchema.parse({ ...patch, reproductionOutputAfter: "clean" });
    expect(parsedPatch).not.toHaveProperty("reproductionOutputAfter");
  });
});

describe("Finding", () => {
  it("accepts any category string, not only the named ones", () => {
    expect(KNOWN_CATEGORIES).toEqual(["vulnerability", "inefficiency", "correctness", "style"]);
    expect(FindingSchema.parse({ ...finding, category: "privacy" }).category).toBe("privacy");
  });

  it("rejects a severity outside the enum", () => {
    expect(FindingSchema.safeParse({ ...finding, severity: "urgent" }).success).toBe(false);
  });

  it("rejects fractional line numbers", () => {
    expect(FindingSchema.safeParse({ ...finding, lineStart: 1.5 }).success).toBe(false);
  });

  it("keeps reproductionCommand optional", () => {
    const { reproductionCommand: _omit, ...withoutCommand } = finding;
    expect(FindingSchema.parse(withoutCommand)).toEqual(withoutCommand);
  });
});

describe("Patch", () => {
  it("validates embedded regressionFindings as full Findings", () => {
    expect(PatchSchema.parse({ ...patch, regressionFindings: [finding] }).regressionFindings).toEqual([finding]);
    const broken = { ...finding, reproducible: "no" };
    expect(PatchSchema.safeParse({ ...patch, regressionFindings: [broken] }).success).toBe(false);
  });

  it("limits challengerVerdict and status to their enums", () => {
    expect(PatchSchema.safeParse({ ...patch, challengerVerdict: "pending" }).success).toBe(false);
    expect(PatchSchema.safeParse({ ...patch, status: "approved" }).success).toBe(false);
  });
});

describe("Run", () => {
  it("lists stages in pipeline order", () => {
    expect(RunSchema.shape.stage.options).toEqual(["ingest", "detect", "diagnose", "repair", "verify", "done"]);
  });

  it("rejects an unknown target kind", () => {
    expect(RunSchema.safeParse({ ...run, target: { kind: "gitlab", ref: "x" } }).success).toBe(false);
  });
});

describe("Executor data", () => {
  it("requires a positive integer timeout", () => {
    expect(ExecRequestSchema.safeParse({ ...execRequest, timeoutMs: 0 }).success).toBe(false);
    expect(ExecRequestSchema.safeParse({ ...execRequest, timeoutMs: 1.5 }).success).toBe(false);
  });

  it("treats a non-zero exit code as data, not an error", () => {
    expect(ExecResultSchema.parse({ ...execResult, exitCode: 2 }).exitCode).toBe(2);
  });
});

describe("JSON Schema for Gemini structured output", () => {
  const schemas = {
    FindingSchema,
    DiagnosisSchema,
    PatchSchema,
    RunSchema,
    WorkspaceSchema,
    ExecRequestSchema,
    ExecResultSchema,
  };

  it.each(Object.entries(schemas))("converts %s, requiring exactly its non-optional fields", (_name, schema) => {
    const json = z.toJSONSchema(schema) as { properties: Record<string, unknown>; required: string[] };
    const optional = Object.entries(schema.shape)
      .filter(([, field]) => field.safeParse(undefined).success)
      .map(([key]) => key);
    expect(Object.keys(json.properties).sort()).toEqual(keys(schema));
    expect([...json.required].sort()).toEqual(keys(schema).filter((key) => !optional.includes(key)));
  });

  it("carries field descriptions into the JSON Schema", () => {
    const json = z.toJSONSchema(DiagnosisSchema) as { properties: Record<string, { description?: string }> };
    expect(json.properties.model?.description).toContain("Exact model ID");
  });
});
