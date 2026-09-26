// Placeholder stages, so the orchestrator runs end to end before lane 2's and lane 3's real stages
// are wired in. They touch no files, run no commands, and call no model. Everything they produce is
// labeled as simulated (detectorId and model "mock", "[mock]" in every message), and each handler
// has `mock: true`, so the run log lists which stages a Run simulated.
//
// Replacing one: pass the real handler in `processRun(db, runId, { stages: { detect } })`; any
// stage not passed stays a mock.
import type { Diagnosis, Finding, Patch, Workspace } from "./contracts.js";
import type {
  DetectHandler,
  DiagnoseHandler,
  IngestHandler,
  PatchVerdict,
  RepairHandler,
  StageHandlers,
  VerifyHandler,
  VerifyInput,
} from "./stages.js";

export interface MockIngestOptions {
  fileIndex?: string[];
  languages?: string[];
  headCommit?: string;
}

export const MOCK_FILE_INDEX = ["package.json", "src/db.js", "src/server.js", "test/db.test.js"];
export const MOCK_HEAD_COMMIT = "0".repeat(40);

/** Lane 2 replaces this with the Repo Adapter. Builds a Workspace without cloning anything. */
export function mockIngest(options: MockIngestOptions = {}): IngestHandler {
  return {
    mock: true,
    async run({ runId }) {
      const workspace: Workspace = {
        runId,
        path: `/mock/workspaces/${runId}`,
        fileIndex: [...(options.fileIndex ?? MOCK_FILE_INDEX)],
        languages: [...(options.languages ?? ["javascript"])],
        headCommit: options.headCommit ?? MOCK_HEAD_COMMIT,
      };
      return { status: "success", output: workspace, summary: `[mock] indexed ${workspace.fileIndex.length} files` };
    },
  };
}

const SOURCE_FILE = /\.(c|m)?(j|t)sx?$|\.py$/;

/**
 * Lane 2 replaces this with the detection engine plus the reproduction step. On the first source
 * file outside test/, emits one confirmed Finding (as if its reproduction command demonstrated the
 * issue) and one unconfirmed one with no reproduction command. No source files, no Findings.
 */
export function mockDetect(): DetectHandler {
  return {
    mock: true,
    async run({ workspace }) {
      const file = workspace.fileIndex.find((path) => SOURCE_FILE.test(path) && !/(^|\/)tests?\//.test(path));
      if (!file) return { status: "success", output: { findings: [] }, summary: "[mock] no source files to scan" };
      const createdAt = new Date().toISOString();
      const reproductionCommand = `[mock] semgrep --config mock.sql-injection ${file}`;
      const findings: Finding[] = [
        {
          id: `fnd_${workspace.runId}_1`,
          detectorId: "mock",
          ruleId: "mock.sql-injection",
          severity: "high",
          category: "vulnerability",
          file,
          lineStart: 10,
          lineEnd: 10,
          message: "[mock] user input reaches a SQL query",
          evidence: "db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)",
          reproducible: true,
          reproductionCommand,
          reproductionOutput: `[mock] ${file}:10: 1 match for mock.sql-injection`,
          createdAt,
        },
        {
          id: `fnd_${workspace.runId}_2`,
          detectorId: "mock",
          ruleId: "mock.unused-variable",
          severity: "low",
          category: "style",
          file,
          lineStart: 3,
          lineEnd: 3,
          message: "[mock] variable is assigned but never used",
          evidence: "const unused = 1;",
          reproducible: false,
          createdAt,
        },
      ];
      return { status: "success", output: { findings }, summary: `[mock] ${findings.length} findings in ${file}` };
    },
  };
}

/** Lane 3 replaces this with the Gemini diagnosis agent. One Diagnosis per Finding. */
export function mockDiagnose(): DiagnoseHandler {
  return {
    mock: true,
    async run({ findings }) {
      const createdAt = new Date().toISOString();
      const diagnoses: Diagnosis[] = findings.map((finding) => ({
        id: `dgn_${finding.id}`,
        findingIds: [finding.id],
        rootCause: `[mock] ${finding.message} at ${finding.file}:${finding.lineStart}`,
        proposedStrategy: `[mock] address ${finding.ruleId} at its reported location`,
        riskNotes: "[mock] placeholder until lane 3's diagnosis agent replaces this stage",
        model: "mock",
        createdAt,
      }));
      return { status: "success", output: { diagnoses } };
    },
  };
}

/**
 * Lane 3 replaces this with the repair agent. One proposed Patch per Diagnosis per round, a
 * unified diff over the first cited Finding's line, reporting passing tests and a fixed Finding.
 */
export function mockRepair(): RepairHandler {
  return {
    mock: true,
    async run({ diagnoses, findings, previousAttempts }) {
      const byId = new Map(findings.map((finding) => [finding.id, finding]));
      const patches: Patch[] = [];
      for (const diagnosis of diagnoses) {
        const finding = diagnosis.findingIds.map((id) => byId.get(id)).find((f) => f !== undefined);
        if (!finding) continue;
        const attempt = previousAttempts.filter((p) => p.diagnosisId === diagnosis.id).length + 1;
        const original = finding.evidence.split("\n")[0] ?? "";
        patches.push({
          id: `pch_${diagnosis.id}_${attempt}`,
          diagnosisId: diagnosis.id,
          diff: [
            `diff --git a/${finding.file} b/${finding.file}`,
            `--- a/${finding.file}`,
            `+++ b/${finding.file}`,
            `@@ -${finding.lineStart} +${finding.lineStart} @@`,
            `-${original}`,
            `+// [mock] repro fix for ${finding.ruleId}`,
            "",
          ].join("\n"),
          filesChanged: [finding.file],
          testsPassed: true,
          originalFindingReproduces: false,
          reproductionOutputAfter: `[mock] ${finding.file}: 0 matches for ${finding.ruleId}`,
          regressionFindings: [],
          challengerVerdict: "disputed",
          status: "proposed",
        });
      }
      return { status: "success", output: { patches } };
    },
  };
}

export interface MockVerifyOptions {
  /** Decides each Patch's verdict. Default: confirm every Patch. */
  verdict?: (patch: Patch, input: VerifyInput) => PatchVerdict["challengerVerdict"];
}

/** Lane 3 replaces this with the Challenger. Confirms every Patch unless told otherwise. */
export function mockVerify(options: MockVerifyOptions = {}): VerifyHandler {
  return {
    mock: true,
    async run(input) {
      const verdicts: PatchVerdict[] = input.patches.map((patch) => {
        const challengerVerdict = options.verdict?.(patch, input) ?? "confirmed";
        return {
          patchId: patch.id,
          challengerVerdict,
          challengerNotes:
            challengerVerdict === "confirmed"
              ? "[mock] no counter-test broke the patch"
              : "[mock] a counter-test still fails against the patched workspace",
        };
      });
      return { status: "success", output: { verdicts } };
    },
  };
}

export interface MockStagesOptions {
  ingest?: MockIngestOptions;
  verify?: MockVerifyOptions;
}

/** A full set of placeholder stages. */
export function createMockStages(options: MockStagesOptions = {}): StageHandlers {
  return {
    ingest: mockIngest(options.ingest),
    detect: mockDetect(),
    diagnose: mockDiagnose(),
    repair: mockRepair(),
    verify: mockVerify(options.verify),
  };
}
