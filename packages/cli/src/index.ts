#!/usr/bin/env node
import { Command } from "commander";
import { apiClientFromEnv } from "./client.ts";
import { runDecide, runScan, runStatus, runWatch } from "./commands.ts";

const io = { log: (line: string) => console.log(line) };

const program = new Command();
program.name("repro").description("Status surface CLI for Repro run tracking");

program
  .command("status")
  .argument("[runId]", "Run ID to inspect; omitted lists recent runs")
  .description("Show a run's stage/status, or list recent runs")
  .action(async (runId?: string) => {
    await runStatus(apiClientFromEnv(), io, runId);
  });

program
  .command("watch")
  .argument("<runId>", "Run ID to watch")
  .option("--interval <ms>", "Poll interval in milliseconds", "5000")
  .description("Poll a run until it reaches a terminal status, printing on each stage/status change")
  .action(async (runId: string, opts: { interval: string }) => {
    await runWatch(apiClientFromEnv(), io, runId, { intervalMs: Number(opts.interval) });
  });

program
  .command("scan")
  .argument("<targetRef>", "Target ref to scan, e.g. a branch name or github owner/repo@ref")
  .option("--kind <kind>", "Target kind: local or github", "github")
  .description("Queue a new Run against a target ref")
  .action(async (targetRef: string, opts: { kind: string }) => {
    if (opts.kind !== "local" && opts.kind !== "github") throw new Error(`--kind must be "local" or "github", got "${opts.kind}"`);
    await runScan(apiClientFromEnv(), io, targetRef, opts.kind);
  });

program
  .command("patch")
  .argument("<patchId>", "Patch ID")
  .argument("<decision>", "merge or reject")
  .description("Merge or reject a verified Patch")
  .action(async (patchId: string, decision: string) => {
    if (decision !== "merge" && decision !== "reject") throw new Error(`decision must be "merge" or "reject", got "${decision}"`);
    await runDecide(apiClientFromEnv(), io, patchId, decision);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
