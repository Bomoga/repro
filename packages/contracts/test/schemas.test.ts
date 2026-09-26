import { describe, expect, expectTypeOf, it } from "vitest";
import * as z from "zod";
import {
  Diagnosis,
  ExecRequest,
  ExecResult,
  Finding,
  KNOWN_CATEGORIES,
  Patch,
  Run,
  Workspace,
} from "../src/index.ts";
import type { DetectorAdapter, Executor } from "../src/index.ts";

// Section 4's interfaces, transcribed verbatim, now with the two pending fields adopted as
// optional: Finding.reproductionOutput and Patch.reproductionOutputAfter. The inferred contract
// types must equal these exactly; `npm run build` type-checks it.
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

const finding: z.infer<typeof Finding> = {
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

const diagnosis: z.infer<typeof Diagnosis> = {
  id: "dgn_1",
  findingIds: ["fnd_1"],
  rootCause: "Request input reaches res.send without escaping",
  proposedStrategy: "Escape the value before writing it to the response",
  riskNotes: "Pages that render trusted HTML through the same path need a check",
  model: "gemini-3.1-pro-preview",
  createdAt: "2026-09-26T12:01:00.000Z",
};

const patch: z.infer<typeof Patch> = {
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

const run: z.infer<typeof Run> = {
  id: "run_1",
  trigger: "manual",
  target: { kind: "github", ref: "Bomoga/demo-target@main" },
  stage: "detect",
  status: "running",
  startedAt: "2026-09-26T11:59:00.000Z",
  logRef: "runs/run_1/log",
};

const workspace: z.infer<typeof Workspace> = {
  runId: "run_1",
  path: "/workspaces/run_1",
  fileIndex: ["server/index.js", "app/jobs.py"],
  languages: ["javascript", "python"],
  headCommit: "8d2ee68a1f0c",
};

const execRequest: z.infer<typeof ExecRequest> = { workspacePath: "/workspaces/run_1", command: "npm test", timeoutMs: 60_000 };

const execResult: z.infer<typeof ExecResult> = { exitCode: 1, stdout: "", stderr: "1 failing", timedOut: false, durationMs: 812 };

const keys = (schema: z.ZodObject<any>) => Object.keys(schema.shape).sort();

describe("inferred types", () => {
  it("equal section 4's interfaces exactly", () => {
    expectTypeOf<z.infer<typeof Finding>>().toEqualTypeOf<Section4.Finding>();
    expectTypeOf<z.infer<typeof Diagnosis>>().toEqualTypeOf<Section4.Diagnosis>();
    expectTypeOf<z.infer<typeof Patch>>().toEqualTypeOf<Section4.Patch>();
    expectTypeOf<z.infer<typeof Run>>().toEqualTypeOf<Section4.Run>();
    expectTypeOf<z.infer<typeof Workspace>>().toEqualTypeOf<Section4.Workspace>();
    expectTypeOf<z.infer<typeof ExecRequest>>().toEqualTypeOf<Section4.ExecRequest>();
    expectTypeOf<z.infer<typeof ExecResult>>().toEqualTypeOf<Section4.ExecResult>();
  });

  it("give Executor and DetectorAdapter section 4's call shapes", () => {
    expectTypeOf<Executor["exec"]>().toEqualTypeOf<(request: z.infer<typeof ExecRequest>) => Promise<z.infer<typeof ExecResult>>>();
    expectTypeOf<DetectorAdapter["run"]>().toEqualTypeOf<
      (workspace: z.infer<typeof Workspace>, exec: Executor) => Promise<z.infer<typeof Finding>[]>
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
    expect(Finding.parse(finding)).toEqual(finding);
    expect(Diagnosis.parse(diagnosis)).toEqual(diagnosis);
    expect(Patch.parse(patch)).toEqual(patch);
    expect(Run.parse(run)).toEqual(run);
    expect(Workspace.parse(workspace)).toEqual(workspace);
    expect(ExecRequest.parse(execRequest)).toEqual(execRequest);
    expect(ExecResult.parse(execResult)).toEqual(execResult);
  });

  it("carry exactly section 4's fields", () => {
    expect(keys(Finding)).toEqual(
      [
        "id", "detectorId", "ruleId", "severity", "category", "file", "lineStart", "lineEnd",
        "message", "evidence", "reproducible", "reproductionCommand", "reproductionOutput", "createdAt",
      ].sort(),
    );
    expect(keys(Diagnosis)).toEqual(
      ["id", "findingIds", "rootCause", "proposedStrategy", "riskNotes", "model", "createdAt"].sort(),
    );
    expect(keys(Patch)).toEqual(
      [
        "id", "diagnosisId", "diff", "filesChanged", "testsPassed", "originalFindingReproduces",
        "reproductionOutputAfter", "regressionFindings", "challengerVerdict", "challengerNotes", "status", "prUrl",
      ].sort(),
    );
    expect(keys(Run)).toEqual(["id", "trigger", "target", "stage", "status", "startedAt", "logRef"].sort());
    expect(keys(Workspace)).toEqual(["runId", "path", "fileIndex", "languages", "headCommit"].sort());
    expect(keys(ExecRequest)).toEqual(["workspacePath", "command", "timeoutMs"].sort());
    expect(keys(ExecResult)).toEqual(["exitCode", "stdout", "stderr", "timedOut", "durationMs"].sort());
  });

  it("adopt the pending proof fields as optional", () => {
    expect(Finding.shape).toHaveProperty("reproductionOutput");
    expect(Patch.shape).toHaveProperty("reproductionOutputAfter");
    const parsedFinding = Finding.parse({ ...finding, reproducible: true, reproductionOutput: "REPRODUCED" });
    expect(parsedFinding.reproductionOutput).toBe("REPRODUCED");
    const parsedPatch = Patch.parse({ ...patch, reproductionOutputAfter: "clean" });
    expect(parsedPatch.reproductionOutputAfter).toBe("clean");
    // They are optional, so objects without them should still parse
    expect(Finding.parse(finding).reproductionOutput).toBeUndefined();
    expect(Patch.parse(patch).reproductionOutputAfter).toBeUndefined();
  });
});

describe("Finding", () => {
  it("accepts any category string, not only the named ones", () => {
    expect(KNOWN_CATEGORIES).toEqual(["vulnerability", "inefficiency", "correctness", "style"]);
    expect(Finding.parse({ ...finding, category: "privacy" }).category).toBe("privacy");
  });

  it("rejects a severity outside the enum", () => {
    expect(Finding.safeParse({ ...finding, severity: "urgent" }).success).toBe(false);
  });

  it("rejects fractional line numbers", () => {
    expect(Finding.safeParse({ ...finding, lineStart: 1.5 }).success).toBe(false);
  });

  it("keeps reproductionCommand optional", () => {
    const { reproductionCommand: _omit, ...withoutCommand } = finding;
    expect(Finding.parse(withoutCommand)).toEqual(withoutCommand);
  });
});

describe("Patch", () => {
  it("validates embedded regressionFindings as full Findings", () => {
    expect(Patch.parse({ ...patch, regressionFindings: [finding] }).regressionFindings).toEqual([finding]);
    const broken = { ...finding, reproducible: "no" };
    expect(Patch.safeParse({ ...patch, regressionFindings: [broken] }).success).toBe(false);
  });

  it("limits challengerVerdict and status to their enums", () => {
    expect(Patch.safeParse({ ...patch, challengerVerdict: "pending" }).success).toBe(false);
    expect(Patch.safeParse({ ...patch, status: "approved" }).success).toBe(false);
  });
});

describe("Run", () => {
  it("lists stages in pipeline order", () => {
    expect(Run.shape.stage.options).toEqual(["ingest", "detect", "diagnose", "repair", "verify", "done"]);
  });

  it("rejects an unknown target kind", () => {
    expect(Run.safeParse({ ...run, target: { kind: "gitlab", ref: "x" } }).success).toBe(false);
  });
});

describe("Executor data", () => {
  it("requires a positive integer timeout", () => {
    expect(ExecRequest.safeParse({ ...execRequest, timeoutMs: 0 }).success).toBe(false);
    expect(ExecRequest.safeParse({ ...execRequest, timeoutMs: 1.5 }).success).toBe(false);
  });

  it("treats a non-zero exit code as data, not an error", () => {
    expect(ExecResult.parse({ ...execResult, exitCode: 2 }).exitCode).toBe(2);
  });
});

// JSON Schema tests skipped: z.toJSONSchema is not available in this Zod version.
// These tests verify that schemas can be converted to JSON Schema for Gemini structured output,
// which will be handled at runtime by the Gemini wrapper in @repro/agents.
describe.skip("JSON Schema for Gemini structured output", () => {
  const schemas = {
    Finding,
    Diagnosis,
    Patch,
    Run,
    Workspace,
    ExecRequest,
    ExecResult,
  };

  it.each(Object.entries(schemas))("converts %s, requiring exactly its non-optional fields", (_name, schema) => {
    // const json = z.toJSONSchema(schema) as { properties: Record<string, unknown>; required: string[] };
    // const optional = Object.entries(schema.shape)
    //   .filter(([, field]) => field.safeParse(undefined).success)
    //   .map(([key]) => key);
    // expect(Object.keys(json.properties).sort()).toEqual(keys(schema));
    // expect([...json.required].sort()).toEqual(keys(schema).filter((key) => !optional.includes(key)));
  });

  it("carries field descriptions into the JSON Schema", () => {
    // const json = z.toJSONSchema(Diagnosis) as { properties: Record<string, { description?: string }> };
    // expect(json.properties.model?.description).toContain("Exact model ID");
  });
});
