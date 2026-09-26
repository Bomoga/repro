import * as z from "zod";
import type { Finding } from "../contracts.js";
import { fence } from "../diagnose/prompt.js";
import { toGeminiSchema, type FunctionCall, type FunctionTool } from "../gemini.js";
import { formatExec, type ReproductionJudge, type Sandbox } from "../sandbox.js";
import { WorkspacePathError, splitLines, type WorkspaceFiles } from "../workspace-files.js";

const ReadFileArgs = z.object({
  path: z.string().describe("Workspace-relative path of a file from the file index, e.g. src/db.js"),
});
const ReplaceInFileArgs = z.object({
  path: z.string().describe("Workspace-relative path of a file from the file index"),
  old_text: z
    .string()
    .describe("Exact text to replace, copied from read_file output including indentation. Must occur exactly once in the file."),
  new_text: z.string().describe("The text that replaces old_text"),
});
const NoArgs = z.object({});
const FinishArgs = z.object({
  summary: z.string().describe("One or two sentences: what you changed and why it removes the root cause"),
});

export const REPAIR_TOOLS: FunctionTool[] = [
  {
    name: "read_file",
    description: "Read a tracked file from the sandboxed checkout. Returns its full text.",
    parameters: toGeminiSchema(ReadFileArgs),
  },
  {
    name: "replace_in_file",
    description: "Replace exactly one occurrence of old_text with new_text in a tracked file. Fails if old_text is missing or ambiguous.",
    parameters: toGeminiSchema(ReplaceInFileArgs),
  },
  {
    name: "run_tests",
    description: "Run the project's own test command in the sandbox and return its exit status and output.",
    parameters: toGeminiSchema(NoArgs),
  },
  {
    name: "rerun_detector",
    description: "Re-run the reproduction command of every finding you are fixing and report whether each still reproduces.",
    parameters: toGeminiSchema(NoArgs),
  },
  {
    name: "finish",
    description: "End this attempt. Call it once the tests pass and rerun_detector shows no finding still reproduces.",
    parameters: toGeminiSchema(FinishArgs),
  },
];

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  /** One line for a live view: what the call did. */
  summary: string;
}

export interface ToolContext {
  files: WorkspaceFiles;
  sandbox: Sandbox;
  /** The Findings the Diagnosis cites. */
  findings: Finding[];
  testCommand?: string;
  judge: ReproductionJudge;
}

export interface ToolOutcome {
  result: string;
  isError: boolean;
  record: ToolCallRecord;
}

const MAX_TOOL_OUTPUT = 6_000;

/** Runs one non-finish tool call. Everything returned is redacted before Gemini sees it. */
export async function runRepairTool(call: FunctionCall, ctx: ToolContext): Promise<ToolOutcome> {
  const fail = (message: string): ToolOutcome => ({
    result: message,
    isError: true,
    record: { name: call.name, arguments: call.arguments, ok: false, summary: message.split("\n")[0]! },
  });
  try {
    switch (call.name) {
      case "read_file": {
        const args = ReadFileArgs.safeParse(call.arguments);
        if (!args.success) return fail(`invalid arguments: ${z.prettifyError(args.error)}`);
        const text = await ctx.files.readView(args.data.path);
        const lines = splitLines(text).length;
        return {
          result: `${ctx.files.normalize(args.data.path)} (${lines} lines)\n${fence(text)}`,
          isError: false,
          record: { name: call.name, arguments: call.arguments, ok: true, summary: `read ${args.data.path} (${lines} lines)` },
        };
      }
      case "replace_in_file": {
        const args = ReplaceInFileArgs.safeParse(call.arguments);
        if (!args.success) return fail(`invalid arguments: ${z.prettifyError(args.error)}`);
        const outcome = await ctx.files.replaceInView(args.data.path, args.data.old_text, args.data.new_text);
        if (!outcome.ok) return fail(outcome.message);
        return {
          result: outcome.message,
          isError: false,
          record: { name: call.name, arguments: call.arguments, ok: true, summary: outcome.message },
        };
      }
      case "run_tests": {
        if (!ctx.testCommand) return fail("this project has no test command Repro could detect; tests can't be run");
        const result = await ctx.sandbox.runTests(ctx.testCommand);
        const passed = !result.timedOut && result.exitCode === 0;
        return {
          result: `${passed ? "TESTS PASSED" : "TESTS FAILED"}\n${ctx.files.redact(formatExec(ctx.testCommand, result, MAX_TOOL_OUTPUT))}`,
          isError: false,
          record: { name: call.name, arguments: call.arguments, ok: passed, summary: passed ? "tests passed" : `tests failed (exit ${result.exitCode})` },
        };
      }
      case "rerun_detector": {
        const checks = await ctx.sandbox.checkReproduction(ctx.findings, ctx.judge);
        const still = checks.filter((c) => c.reproduces).flatMap((c) => c.findingIds);
        const body = checks
          .map((c) => `${c.findingIds.join(", ")}: ${c.reproduces ? "STILL REPRODUCES" : "no longer reproduces"}\n${formatExec(c.command, c.result, MAX_TOOL_OUTPUT / checks.length)}`)
          .join("\n\n");
        return {
          result: ctx.files.redact(body),
          isError: false,
          record: {
            name: call.name,
            arguments: call.arguments,
            ok: still.length === 0,
            summary: still.length === 0 ? "no finding reproduces" : `still reproduces: ${still.join(", ")}`,
          },
        };
      }
      default:
        return fail(`unknown tool: ${call.name}`);
    }
  } catch (error) {
    if (error instanceof WorkspacePathError) return fail(error.message);
    throw error;
  }
}

export function parseFinishSummary(call: FunctionCall): string {
  const args = FinishArgs.safeParse(call.arguments);
  return args.success ? args.data.summary : "";
}
