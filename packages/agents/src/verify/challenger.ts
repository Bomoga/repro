import * as z from "zod";
import {
  ChallengerVerdictSchema,
  DiagnosisSchema,
  FindingSchema,
  PatchSchema,
  type ChallengerVerdict,
  type Diagnosis,
  type Executor,
  type Finding,
  type Patch,
  type Workspace,
} from "../contracts.js";
import { fence } from "../diagnose/prompt.js";
import { parseStructured, toGeminiSchema, type FunctionCall, type FunctionTool, type GeminiClient, type InputItem } from "../gemini.js";
import { Sandbox } from "../sandbox.js";
import { WorkspaceFiles, WorkspacePathError, splitLines } from "../workspace-files.js";
import { CounterTestError, CounterTestRunner, type CounterTest, type CounterTestRun } from "./counter-tests.js";
import { applyGate } from "./gate.js";
import { CHALLENGER_SYSTEM_PROMPT, OUTCOME_TEXT, VERDICT_REQUEST, renderChallengeInput, renderRun } from "./prompt.js";

export const MAX_COUNTER_TESTS = 4;
export const MAX_CHALLENGER_TOOL_CALLS = 10;

const ReadFileArgs = z.object({
  path: z.string().describe("Workspace-relative path of a tracked file, read from the patched tree"),
});
const CounterTestArgs = z.object({
  path: z.string().describe("New file for the test, relative to the repository root, e.g. test/repro-counter-1.test.js"),
  code: z.string().describe("Complete contents of the test file"),
  command: z.string().describe("Command that runs only this test from the repository root, e.g. node --test test/repro-counter-1.test.js"),
  description: z.string().describe("One sentence: the attack this test makes"),
});

export const CHALLENGER_TOOLS: FunctionTool[] = [
  { name: "read_file", description: "Read a tracked file from the patched tree.", parameters: toGeminiSchema(ReadFileArgs) },
  {
    name: "run_counter_test",
    description: "Write a test to a new file and run it against the original commit and against the patched tree.",
    parameters: toGeminiSchema(CounterTestArgs),
  },
];

const VerdictSchema = z.object({
  verdict: ChallengerVerdictSchema.describe('"confirmed" only if you tried to break the patch and could not'),
  notes: z.string().min(1).describe("What you tried and what happened; for a dispute, exactly what the fix must still handle"),
});

export interface ChallengeInput {
  /** Must be `proposed`: the Challenger reviews a Patch exactly once. */
  patch: Patch;
  diagnosis: Diagnosis;
  /** Every Finding in the Run (cited ones are shown; all feed secret redaction). */
  findings: Finding[];
  workspace: Workspace;
  testCommand?: string;
  /** Counter-tests that broke the previous attempt; replayed deterministically first. */
  replay?: CounterTest[];
}

export interface ChallengeDeps {
  gemini: GeminiClient;
  executor: Executor;
  maxCounterTests?: number;
  maxToolCalls?: number;
  onCounterTest?: (run: CounterTestRun) => void;
}

export interface ChallengeResult {
  /** Gated: `verified` or `rejected`, with challengerVerdict and challengerNotes filled in. */
  patch: Patch;
  /** What Gemini answered, before the counter-test rule was applied. */
  modelVerdict?: ChallengerVerdict;
  /** Every counter-test run, replays first. */
  counterTests: CounterTestRun[];
  interactionIds: string[];
}

export async function challenge(input: ChallengeInput, deps: ChallengeDeps): Promise<ChallengeResult> {
  const patch = PatchSchema.parse(input.patch);
  if (patch.status !== "proposed") throw new Error(`only a proposed Patch can be challenged; ${patch.id} is ${patch.status}`);
  const diagnosis = DiagnosisSchema.parse(input.diagnosis);
  if (diagnosis.id !== patch.diagnosisId) throw new Error(`Patch ${patch.id} belongs to Diagnosis ${patch.diagnosisId}, not ${diagnosis.id}`);
  const findings = input.findings.map((finding) => FindingSchema.parse(finding));
  const cited = findings.filter((finding) => diagnosis.findingIds.includes(finding.id));
  const maxCounterTests = deps.maxCounterTests ?? MAX_COUNTER_TESTS;
  const maxToolCalls = deps.maxToolCalls ?? MAX_CHALLENGER_TOOL_CALLS;

  const sandbox = new Sandbox(input.workspace, deps.executor);
  const files = await WorkspaceFiles.open(input.workspace, findings);
  const redact = (text: string) => files.redact(text);
  const runner = await CounterTestRunner.prepare(sandbox, files, patch);
  const runs: CounterTestRun[] = [];
  const interactionIds: string[] = [];
  const record = (run: CounterTestRun) => {
    runs.push(run);
    deps.onCounterTest?.(run);
  };

  let verdict: z.infer<typeof VerdictSchema> | undefined;
  try {
    const replayed: CounterTestRun[] = [];
    for (const test of input.replay ?? []) {
      try {
        const run = await runner.run(test);
        record(run);
        replayed.push(run);
      } catch (error) {
        if (!(error instanceof CounterTestError)) throw error;
      }
    }

    let next: string | InputItem[] = renderChallengeInput({
      findings: cited,
      diagnosis,
      patch,
      fileIndex: input.workspace.fileIndex,
      testCommand: input.testCommand,
      replayed,
      maxCounterTests,
      maxToolCalls,
      redact,
    });
    let previousInteractionId: string | undefined;
    let toolCalls = 0;
    let counterTests = 0;
    let pending: InputItem[] = [];

    // Attack: tools only, until the model stops calling them or the budget runs out.
    for (let turn = 1; ; turn++) {
      const response = await deps.gemini.interact({
        role: "challenger",
        systemInstruction: CHALLENGER_SYSTEM_PROMPT,
        input: next,
        previousInteractionId,
        tools: CHALLENGER_TOOLS,
        label: `challenge:${patch.id}.${turn}`,
      });
      interactionIds.push(response.interactionId);
      previousInteractionId = response.interactionId;
      if (response.functionCalls.length === 0) break;

      const results: InputItem[] = [];
      for (const call of response.functionCalls) {
        if (toolCalls >= maxToolCalls) {
          results.push({ type: "function_result", callId: call.id, name: call.name, result: "not run: the tool budget is spent", isError: true });
          continue;
        }
        toolCalls++;
        let outcome: { result: string; isError: boolean };
        if (call.name === "run_counter_test" && counterTests >= maxCounterTests) {
          outcome = { result: `not run: the budget of ${maxCounterTests} counter-tests is spent`, isError: true };
        } else {
          if (call.name === "run_counter_test") counterTests++;
          outcome = await runChallengerTool(call, files, runner, record, redact);
        }
        results.push({ type: "function_result", callId: call.id, name: call.name, ...outcome });
      }
      if (toolCalls >= maxToolCalls) {
        pending = results;
        break;
      }
      const remaining = maxToolCalls - toolCalls;
      next = [...results, { type: "text", text: `${remaining} tool calls and ${maxCounterTests - counterTests} counter-tests left.` }];
    }

    // Verdict: one structured call with no tools (section 5's fallback shape), retried once.
    const verdictSchema = toGeminiSchema(VerdictSchema);
    let verdictInput: InputItem[] = [...pending, { type: "text", text: VERDICT_REQUEST }];
    for (let attempt = 1; attempt <= 2 && !verdict; attempt++) {
      const response = await deps.gemini.interact({
        role: "challenger",
        systemInstruction: CHALLENGER_SYSTEM_PROMPT,
        input: verdictInput,
        previousInteractionId,
        responseSchema: verdictSchema,
        label: `challenge:${patch.id}.verdict#${attempt}`,
      });
      interactionIds.push(response.interactionId);
      previousInteractionId = response.interactionId;
      const parsed = parseStructured(response.outputText, VerdictSchema);
      if (parsed.ok) verdict = parsed.value;
      else verdictInput = [{ type: "text", text: `That verdict was rejected (${parsed.error}). ${VERDICT_REQUEST}` }];
    }
  } finally {
    await runner.dispose();
  }

  const decision = decideVerdict(verdict?.verdict, runs);
  const challengerNotes = buildNotes(verdict?.notes, decision.override, runs);
  const gated = applyGate({ ...patch, challengerVerdict: decision.verdict, challengerNotes });
  return { patch: gated, modelVerdict: verdict?.verdict, counterTests: runs, interactionIds };
}

async function runChallengerTool(
  call: FunctionCall,
  files: WorkspaceFiles,
  runner: CounterTestRunner,
  record: (run: CounterTestRun) => void,
  redact: (text: string) => string,
): Promise<{ result: string; isError: boolean }> {
  try {
    if (call.name === "read_file") {
      const args = ReadFileArgs.safeParse(call.arguments);
      if (!args.success) return { result: `invalid arguments: ${z.prettifyError(args.error)}`, isError: true };
      const text = await files.readView(args.data.path);
      return { result: `${files.normalize(args.data.path)} (${splitLines(text).length} lines)\n${fence(text)}`, isError: false };
    }
    if (call.name === "run_counter_test") {
      const args = CounterTestArgs.safeParse(call.arguments);
      if (!args.success) return { result: `invalid arguments: ${z.prettifyError(args.error)}`, isError: true };
      const run = await runner.run(args.data);
      record(run);
      return { result: renderRun(run, redact), isError: false };
    }
    return { result: `unknown tool: ${call.name}`, isError: true };
  } catch (error) {
    if (error instanceof WorkspacePathError || error instanceof CounterTestError) return { result: error.message, isError: true };
    throw error;
  }
}

function pathKey(file: string): string {
  return file.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/** The latest run of each counter-test path; an earlier broken version of a test doesn't count. */
export function latestRuns(runs: CounterTestRun[]): CounterTestRun[] {
  const latest = new Map<string, CounterTestRun>();
  for (const run of runs) latest.set(pathKey(run.test.path), run);
  return [...latest.values()];
}

/**
 * Gemini's verdict is one input, checked against what its own counter-tests showed: a
 * confirmation stands only if at least one attack failed before the patch and passes after it,
 * and no attack still fails on the patched tree.
 */
export function decideVerdict(
  modelVerdict: ChallengerVerdict | undefined,
  runs: CounterTestRun[],
): { verdict: ChallengerVerdict; override?: string } {
  if (modelVerdict !== "confirmed") return { verdict: "disputed" };
  const latest = latestRuns(runs);
  const failing = latest.filter((run) => run.outcome === "hole-open" || run.outcome === "regression");
  if (failing.length > 0) {
    return {
      verdict: "disputed",
      override: `Gemini answered "confirmed", but these counter-tests still fail on the patched tree: ${failing.map((run) => run.test.path).join(", ")}.`,
    };
  }
  if (!latest.some((run) => run.outcome === "fix-holds")) {
    return {
      verdict: "disputed",
      override: 'Gemini answered "confirmed" without a counter-test that failed before the patch and passes after it.',
    };
  }
  return { verdict: "confirmed" };
}

function buildNotes(modelNotes: string | undefined, override: string | undefined, runs: CounterTestRun[]): string {
  const lines = [modelNotes?.trim() || "The Challenger gave no valid verdict, so the patch is treated as disputed."];
  if (override) lines.push("", `Harness override: ${override}`);
  const latest = latestRuns(runs);
  if (latest.length > 0) {
    lines.push("", "Counter-tests, run by the harness against the original commit and the patched tree (latest run of each path):");
    for (const run of latest) lines.push(`- ${run.test.path}: ${run.test.description} → ${OUTCOME_TEXT[run.outcome]}`);
  }
  return lines.join("\n");
}
