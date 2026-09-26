#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { table } from "table";

const API_BASE = process.env.REPRO_API_URL || "http://localhost:3000";

const program = new Command();

program.name("repro").description("Repro: AI-powered code repair and verification").version("0.1.0");

// Helper to make API calls
async function apiCall(procedure: string, input?: any) {
  const response = await fetch(`${API_BASE}/api/trpc/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }
  return response.json();
}

// status command
program
  .command("status")
  .description("Get status of runs")
  .option("--run <id>", "Show detailed info for a specific run")
  .option("--limit <n>", "Number of runs to list", "10")
  .action(async (opts) => {
    try {
      if (opts.run) {
        const run = await apiCall("run", { id: opts.run });
        if (!run) {
          console.log(chalk.red("Run not found"));
          return;
        }
        console.log(chalk.cyan("\n=== Run Details ==="));
        console.log(`ID: ${chalk.yellow(run.id)}`);
        console.log(`Status: ${chalk.blue(run.status)}`);
        console.log(`Stage: ${chalk.blue(run.stage)}`);
        console.log(`Trigger: ${chalk.blue(run.trigger)}`);
        console.log(`Target: ${run.target.kind}:${run.target.ref}`);
        console.log(`Started: ${run.startedAt}`);
      } else {
        const limit = parseInt(opts.limit, 10);
        const runs = await apiCall("runs", { limit, offset: 0 });
        if (runs.length === 0) {
          console.log(chalk.yellow("No runs found"));
          return;
        }
        const data = [
          [chalk.cyan("ID"), chalk.cyan("Status"), chalk.cyan("Stage"), chalk.cyan("Trigger"), chalk.cyan("Target")],
          ...runs.map((r: any) => [
            r.id.slice(0, 12),
            r.status,
            r.stage,
            r.trigger,
            `${r.target.kind}:${r.target.ref}`,
          ]),
        ];
        console.log("\n" + table(data));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

// scan command
program
  .command("scan")
  .description("Queue a new scan")
  .argument("[target]", "Target ref (local path or github ref)", ".")
  .option("--kind <kind>", "Target kind (local or github)", "local")
  .action(async (target, opts) => {
    try {
      const run = await apiCall("createRun", {
        trigger: "manual",
        target: {
          kind: opts.kind,
          ref: target,
        },
        stage: "ingest",
        status: "queued",
        startedAt: new Date().toISOString(),
        logRef: `log-${Date.now()}`,
      });
      console.log(chalk.green(`\nRun queued: ${chalk.yellow(run.id)}`));
      console.log(chalk.gray("Use 'repro watch --run " + run.id + "' to monitor progress"));
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

// watch command
program
  .command("watch")
  .description("Watch a run until completion")
  .requiredOption("--run <id>", "Run ID to watch")
  .option("--interval <ms>", "Poll interval in ms", "1000")
  .action(async (opts) => {
    const runId = opts.run;
    const interval = parseInt(opts.interval, 10);

    try {
      const startTime = Date.now();
      const maxWaitMs = 5 * 60 * 1000; // 5 minute timeout for demo

      const poll = async () => {
        const run = await apiCall("run", { id: runId });
        if (!run) {
          console.log(chalk.red("Run not found"));
          process.exit(1);
        }

        const elapsed = Date.now() - startTime;
        const status = run.status;
        const stage = run.stage;

        const statusColor =
          status === "completed" ? "green" :
          status === "failed" ? "red" :
          status === "running" ? "blue" : "yellow";

        console.clear();
        console.log(chalk.cyan("=== Repro Run Monitor ===\n"));
        console.log(`Run: ${chalk.yellow(runId.slice(0, 12))}`);
        console.log(`Status: ${chalk[statusColor as any](status)}`);
        console.log(`Stage: ${chalk.blue(stage)}`);
        console.log(`Elapsed: ${(elapsed / 1000).toFixed(1)}s`);

        if (status === "completed" || status === "failed") {
          console.log(`\n${chalk.green("✓ Run finished")}`);
          process.exit(status === "completed" ? 0 : 1);
        }

        if (elapsed > maxWaitMs) {
          console.log(chalk.yellow("\nTimeout waiting for run to complete"));
          process.exit(1);
        }

        setTimeout(poll, interval);
      };

      poll();
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

program.parse();
