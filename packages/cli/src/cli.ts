#!/usr/bin/env node
import { Command } from "commander";
import { createClient } from "./client.js";
import { statusCommand } from "./commands/status.js";
import { watchCommand } from "./commands/watch.js";
import { scanCommand } from "./commands/scan.js";

const program = new Command();

program
  .name("repro")
  .description("Status CLI for the Repro pipeline (Runs, Findings, Diagnoses, Patches)")
  .version("0.1.0")
  .option("--api-url <url>", "Repro API base URL", process.env.REPRO_API_URL ?? "http://localhost:4000");

program
  .command("status")
  .description("show recent runs, or one run's detail")
  .argument("[runId]", "run id to inspect; omit to list recent runs")
  .action(async (runId: string | undefined) => {
    await statusCommand(createClient(program.opts().apiUrl), runId);
  });

program
  .command("watch")
  .description("poll a run until it finishes, printing stage/status changes")
  .argument("<runId>")
  .option("--interval <ms>", "poll interval in milliseconds", "2000")
  .action(async (runId: string, opts: { interval: string }) => {
    await watchCommand(createClient(program.opts().apiUrl), runId, { intervalMs: Number(opts.interval) });
  });

program
  .command("scan")
  .description("queue a new run against a target")
  .argument("<ref>", "a local path or a github owner/repo#ref")
  .option("--kind <kind>", "local or github", "local")
  .option("--trigger <trigger>", "manual, schedule, or webhook", "manual")
  .action(async (ref: string, opts: { kind: "local" | "github"; trigger: "manual" | "schedule" | "webhook" }) => {
    await scanCommand(createClient(program.opts().apiUrl), ref, opts);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
