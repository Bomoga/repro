import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { createApiClient, DEFAULT_API_URL, type ApiClient } from "./client.ts";
import { decideCommand, guarded, scanCommand, statusCommand, watchCommand, type CommandContext } from "./commands.ts";

// `repro`: the status surface's CLI (CLAUDE.md section 7). Its only inputs are a target ref, IDs,
// and flags, never free text (section 8's no-chat-surface rule).

export interface CliEnvironment {
  env: NodeJS.ProcessEnv;
  out(line: string): void;
  err(line: string): void;
  color: boolean;
  now(): Date;
  sleep(ms: number): Promise<void>;
  cwd: string;
  exists?: (path: string) => boolean;
  createClient?: (apiUrl: string) => ApiClient;
}

const RUN_STATUSES = ["queued", "running", "blocked", "completed", "failed"] as const;

/** A usage mistake caught after argv parsing: printed as one line, exit code 1. */
class UsageError extends Error {}

/** The API's page-size cap for runs.list / runs.summaries. */
const MAX_LIMIT = 200;

function limit(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_LIMIT) throw new InvalidArgumentError(`expected a whole number from 1 to ${MAX_LIMIT}`);
  return n;
}

function seconds(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new InvalidArgumentError("expected a positive number of seconds");
  return n * 1000;
}

/** Parses `argv` (without the node and script entries), runs the command, and returns the exit code. */
export async function runCli(argv: string[], environment: CliEnvironment): Promise<number> {
  let exitCode = 0;
  const program = new Command();

  const context = (): CommandContext => {
    const apiUrl: string = program.opts().api;
    return {
      client: (environment.createClient ?? createApiClient)(apiUrl),
      apiUrl,
      out: environment.out,
      err: environment.err,
      color: environment.color,
      now: environment.now,
      sleep: environment.sleep,
      cwd: environment.cwd,
      exists: environment.exists,
    };
  };
  const run = async (command: (ctx: CommandContext) => Promise<number>) => {
    const ctx = context();
    exitCode = await guarded(ctx, () => command(ctx));
  };

  program
    .name("repro")
    .description("Queue Repro scans and follow their runs through ingest, detect, diagnose, repair, and verify.")
    .option("--api <url>", "Repro API base URL (env: REPRO_API_URL)", environment.env.REPRO_API_URL || DEFAULT_API_URL)
    .exitOverride()
    .configureOutput({ writeOut: (s) => environment.out(s.trimEnd()), writeErr: (s) => environment.err(s.trimEnd()) })
    .showHelpAfterError();

  program
    .command("status")
    .description("List recent runs, or show one run's findings, diagnoses, and patches")
    .argument("[runId]", "run to show in detail (same as --run)")
    .option("--run <runId>", "run to show in detail")
    .addOption(new Option("--status <status>", "only list runs with this status").choices(RUN_STATUSES))
    .option("--limit <n>", "how many runs to list", limit, 20)
    .option("--json", "print JSON instead of text")
    .action(async (positional: string | undefined, opts: { run?: string; status?: (typeof RUN_STATUSES)[number]; limit: number; json?: boolean }) => {
      if (positional && opts.run && positional !== opts.run) {
        throw new UsageError(`two different runs given: ${positional} and --run ${opts.run}`);
      }
      await run((ctx) => statusCommand(ctx, { runId: opts.run ?? positional, status: opts.status, limit: opts.limit, json: opts.json }));
    });

  program
    .command("scan")
    .description("Queue a new run against a local path or a GitHub ref")
    .argument("[target]", "local path (default: the current directory), owner/repo, owner/repo#rev, or a github.com URL", ".")
    .addOption(new Option("--kind <kind>", "target kind, when it can't be inferred").choices(["local", "github"] as const))
    .option("--watch", "follow the run until it finishes")
    .option("--interval <seconds>", "poll interval with --watch", seconds, 2000)
    .option("--timeout <seconds>", "give up watching after this long (exit code 2)", seconds)
    .option("--json", "print JSON instead of text")
    .action(async (target: string, opts: { kind?: "local" | "github"; watch?: boolean; interval: number; timeout?: number; json?: boolean }) => {
      await run((ctx) =>
        scanCommand(ctx, target, { kind: opts.kind, watch: opts.watch, intervalMs: opts.interval, timeoutMs: opts.timeout, json: opts.json }),
      );
    });

  program
    .command("watch")
    .description("Poll a run until it completes (exit 0) or fails (exit 1)")
    .argument("[runId]", "run to watch (same as --run)")
    .option("--run <runId>", "run to watch")
    .option("--interval <seconds>", "poll interval", seconds, 2000)
    .option("--timeout <seconds>", "give up after this long (exit code 2)", seconds)
    .option("--json", "print each change as a JSON line")
    .action(async (positional: string | undefined, opts: { run?: string; interval: number; timeout?: number; json?: boolean }) => {
      const runId = opts.run ?? positional;
      if (!runId) throw new UsageError("which run? pass a run ID or --run <runId>");
      if (positional && opts.run && positional !== opts.run) {
        throw new UsageError(`two different runs given: ${positional} and --run ${opts.run}`);
      }
      await run((ctx) => watchCommand(ctx, runId, { intervalMs: opts.interval, timeoutMs: opts.timeout, json: opts.json }));
    });

  program
    .command("patch")
    .description("Record a merge or reject decision on a verified patch")
    .argument("<patchId>", "patch to decide on")
    .addArgument(program.createArgument("<decision>", "merge or reject").choices(["merge", "reject"]))
    .action(async (patchId: string, decision: "merge" | "reject") => {
      await run((ctx) => decideCommand(ctx, patchId, decision));
    });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof UsageError) {
      environment.err(`error: ${error.message}`);
      return 1;
    }
    // Commander has already printed its own message (unknown command, bad option, --help).
    if (error instanceof CommanderError) return error.exitCode;
    throw error;
  }
  return exitCode;
}
