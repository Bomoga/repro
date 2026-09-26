import { randomUUID } from "node:crypto";
import {
  DiagnosisSchema,
  FindingSchema,
  PatchSchema,
  type DetectorAdapter,
  type Diagnosis,
  type Executor,
  type Finding,
  type Patch,
  type Workspace,
} from "../contracts.js";
import { isRepairEligible } from "../diagnose/diagnose.js";
import type { GeminiClient, InputItem } from "../gemini.js";
import { Sandbox, defaultReproductionJudge, formatExec, type ReproductionJudge } from "../sandbox.js";
import { WorkspaceFiles } from "../workspace-files.js";
import { REPAIR_SYSTEM_PROMPT, renderRepairInput } from "./prompt.js";
import { findRegressions } from "./regressions.js";
import { REPAIR_TOOLS, parseFinishSummary, runRepairTool, type ToolCallRecord, type ToolContext } from "./tools.js";

/** Working tool calls per attempt (section 5). `finish` doesn't count against it. */
export const MAX_TOOL_CALLS = 15;

export interface RepairInput {
  diagnosis: Diagnosis;
  /** Every Finding in the Run: cited Findings are looked up here, and all of them feed secret
   *  redaction and the regression baseline. Read-only. */
  findings: Finding[];
  workspace: Workspace;
  /** The project's test command; detected from the workspace when omitted. */
  testCommand?: string;
  /** Why the previous attempt on this Diagnosis was rejected (the verify-to-diagnose retry edge). */
  feedback?: string;
  attempt?: number;
}

export interface RepairDeps {
  gemini: GeminiClient;
  executor: Executor;
  /** Every enabled detector; re-run on the patched tree to find regressions. */
  detectors: DetectorAdapter[];
  judgeReproduction?: ReproductionJudge;
  maxToolCalls?: number;
  /** Called as each tool call completes, for a live view of the repair. */
  onToolCall?: (record: ToolCallRecord) => void;
  now?: () => Date;
  newId?: () => string;
}

export type RepairStopReason = "finished" | "tool_limit" | "stalled";

export interface RepairResult {
  /** `proposed` if the model finished with a non-empty diff, otherwise `rejected`. */
  patch: Patch;
  stopReason: RepairStopReason;
  toolCalls: ToolCallRecord[];
  /** The model's own account of its change, from `finish`: prose, not evidence. */
  summary?: string;
  /** The harness's own test run after the loop, redacted. */
  testOutput?: string;
  interactionIds: string[];
}

export async function repair(input: RepairInput, deps: RepairDeps): Promise<RepairResult> {
  const findings = input.findings.map((finding) => FindingSchema.parse(finding));
  const diagnosis = DiagnosisSchema.parse(input.diagnosis);
  if (!isRepairEligible(diagnosis, findings)) {
    throw new Error(`Diagnosis ${diagnosis.id} cites a Finding that isn't reproducible, so it can't go to Repair`);
  }
  const cited = diagnosis.findingIds.map((id) => findings.find((f) => f.id === id)!);
  const maxToolCalls = deps.maxToolCalls ?? MAX_TOOL_CALLS;
  const judge = deps.judgeReproduction ?? defaultReproductionJudge;
  const attempt = input.attempt ?? 1;

  const sandbox = new Sandbox(input.workspace, deps.executor);
  await sandbox.resetToHead();
  const files = await WorkspaceFiles.open(input.workspace, findings);
  const testCommand = input.testCommand ?? (await detectTestCommand(files));
  const ctx: ToolContext = { files, sandbox, findings: cited, testCommand, judge };

  const toolCalls: ToolCallRecord[] = [];
  const interactionIds: string[] = [];
  const record = (entry: ToolCallRecord) => {
    toolCalls.push(entry);
    deps.onToolCall?.(entry);
  };
  let next: string | InputItem[] = renderRepairInput({
    diagnosis,
    findings: cited,
    fileIndex: input.workspace.fileIndex,
    maxToolCalls,
    testCommand,
    feedback: input.feedback,
    redact: (text) => files.redact(text),
  });
  let previousInteractionId: string | undefined;
  let stopReason: RepairStopReason | undefined;
  let summary: string | undefined;
  let working = 0;
  let nudged = false;

  for (let turn = 1; !stopReason; turn++) {
    const response = await deps.gemini.interact({
      role: "repair",
      systemInstruction: REPAIR_SYSTEM_PROMPT,
      input: next,
      previousInteractionId,
      tools: REPAIR_TOOLS,
      label: `repair:${diagnosis.id}#${attempt}.${turn}`,
    });
    interactionIds.push(response.interactionId);
    previousInteractionId = response.interactionId;

    if (response.functionCalls.length === 0) {
      if (nudged) {
        stopReason = "stalled";
        break;
      }
      nudged = true;
      next = [{ type: "text", text: "Use the tools to make and check the fix, then call finish." }];
      continue;
    }

    const budgetSpent = working >= maxToolCalls;
    const results: InputItem[] = [];
    for (const call of response.functionCalls) {
      if (call.name === "finish") {
        summary = parseFinishSummary(call);
        record({ name: call.name, arguments: call.arguments, ok: true, summary: "finished" });
        stopReason = "finished";
        break;
      }
      if (budgetSpent) {
        // The grace turn after the budget runs out accepts only finish.
        stopReason = "tool_limit";
        break;
      }
      if (working >= maxToolCalls) {
        results.push({ type: "function_result", callId: call.id, name: call.name, result: "not run: the tool budget is spent", isError: true });
        continue;
      }
      working++;
      const outcome = await runRepairTool(call, ctx);
      record(outcome.record);
      results.push({ type: "function_result", callId: call.id, name: call.name, result: outcome.result, isError: outcome.isError });
    }
    if (stopReason) break;
    const remaining = maxToolCalls - working;
    const note =
      remaining > 0
        ? `${remaining} tool call${remaining === 1 ? "" : "s"} left in this attempt.`
        : "The tool budget is spent. Call finish now; any other call ends the attempt as failed.";
    next = [...results, { type: "text", text: note }];
  }

  return evaluate({ diagnosis, cited, findings, input, deps, sandbox, files, testCommand, judge, stopReason: stopReason!, toolCalls, summary, interactionIds });
}

/** Deterministic judgement of whatever the attempt left in the workspace. */
async function evaluate(args: {
  diagnosis: Diagnosis;
  cited: Finding[];
  findings: Finding[];
  input: RepairInput;
  deps: RepairDeps;
  sandbox: Sandbox;
  files: WorkspaceFiles;
  testCommand?: string;
  judge: ReproductionJudge;
  stopReason: RepairStopReason;
  toolCalls: ToolCallRecord[];
  summary?: string;
  interactionIds: string[];
}): Promise<RepairResult> {
  const { sandbox, files, deps } = args;
  const diff = await sandbox.diff();
  const changed = diff.trim() !== "";
  const filesChanged = changed ? await sandbox.changedFiles() : [];

  let testsPassed = false;
  let testOutput: string | undefined;
  if (changed && args.testCommand) {
    const result = await sandbox.runTests(args.testCommand);
    testsPassed = !result.timedOut && result.exitCode === 0;
    testOutput = files.redact(formatExec(args.testCommand, result));
  }

  const checks = changed ? await sandbox.checkReproduction(args.cited, args.judge) : [];
  const originalFindingReproduces = !changed || checks.some((check) => check.reproduces);
  const reproductionOutputAfter =
    checks.length > 0 ? files.redact(checks.map((check) => formatExec(check.command, check.result)).join("\n\n")) : undefined;

  const regressionFindings = changed
    ? await findRegressions({
        detectors: deps.detectors,
        workspace: args.input.workspace,
        executor: deps.executor,
        baseline: args.findings,
        cited: args.cited,
        changedFiles: filesChanged,
      })
    : [];

  const patch = PatchSchema.parse({
    id: (deps.newId ?? randomUUID)(),
    diagnosisId: args.diagnosis.id,
    diff,
    filesChanged,
    testsPassed,
    originalFindingReproduces,
    ...(reproductionOutputAfter !== undefined ? { reproductionOutputAfter } : {}),
    regressionFindings,
    // Fail closed until the Challenger has actually looked: only its confirmation counts.
    challengerVerdict: "disputed",
    challengerNotes: "Not yet challenged.",
    status: args.stopReason === "finished" && changed ? "proposed" : "rejected",
  });
  return {
    patch,
    stopReason: args.stopReason,
    toolCalls: args.toolCalls,
    summary: args.summary,
    testOutput,
    interactionIds: args.interactionIds,
  };
}

/** Best guess at the project's own test command when the caller doesn't supply one. */
export async function detectTestCommand(files: WorkspaceFiles): Promise<string | undefined> {
  if (files.has("package.json")) {
    try {
      const pkg = JSON.parse(await files.readView("package.json")) as { scripts?: { test?: unknown } };
      const test = pkg.scripts?.test;
      if (typeof test === "string" && test.trim() && !/no test specified/i.test(test)) return "npm test";
    } catch {
      // An unparseable package.json falls through to the other checks.
    }
  }
  const index = files.workspace.fileIndex;
  const pythonTests = index.some(
    (file) => /(^|\/)(pytest\.ini|conftest\.py)$/.test(file) || /(^|\/)(tests?\/.*|test_[^/]*)\.py$/.test(file),
  );
  return pythonTests ? "python -m pytest -q" : undefined;
}
