import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { TRPCClientError } from "@trpc/client";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, InMemoryRunStore, seedDemoData } from "@repro/api";
import { createApiClient, type ApiClient } from "../src/client.ts";
import { runCli, type CliEnvironment } from "../src/program.ts";

// The CLI end to end: real argv parsing, the real tRPC client, and a real API server on an
// ephemeral port backed by the in-memory store with the demo data. Only the clock and sleep are
// fake, so `watch` runs instantly and ages print deterministically.

const NOW = new Date("2026-09-26T12:00:00.000Z");
const execFileAsync = promisify(execFile);

let store: InMemoryRunStore;
let app: FastifyInstance;
let apiUrl: string;
let workdir: string;

beforeEach(async () => {
  store = new InMemoryRunStore();
  await seedDemoData(store, { now: NOW });
  app = buildApp(store);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  apiUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  workdir = mkdtempSync(join(tmpdir(), "repro-cli-"));
});

afterEach(async () => {
  await app.close();
  rmSync(workdir, { recursive: true, force: true });
});

interface CliResult {
  code: number;
  out: string[];
  err: string[];
  stdout: string;
}

async function repro(argv: string[], overrides: Partial<CliEnvironment> = {}): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  let clock = NOW.getTime();
  const code = await runCli(["--api", apiUrl, ...argv], {
    env: {},
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    color: false,
    now: () => new Date(clock),
    sleep: async (ms) => {
      clock += ms;
    },
    cwd: workdir,
    ...overrides,
  });
  return { code, out, err, stdout: out.join("\n") };
}

describe("repro status", () => {
  it("lists runs newest first with their reproduced and verified tallies", async () => {
    const { code, out } = await repro(["status"]);
    expect(code).toBe(0);
    expect(out[0]).toMatch(/^RUN\s+STATUS\s+STAGE\s+REPRODUCED\s+VERIFIED\s+STARTED\s+TARGET$/);
    expect(out.slice(1).map((line) => line.split(/\s{2,}/))).toEqual([
      ["run_demo_queued", "queued", "ingest", "0/0", "0/0", "30s ago", "local:/demo/seeded-assistant#main"],
      ["run_demo_repairing", "running", "repair", "2/3", "0/1", "6m ago", "local:/demo/notes-api#main"],
      ["run_demo_completed", "completed", "done", "4/6", "3/5", "2h ago", "local:/demo/seeded-assistant"],
      ["run_demo_failed", "failed", "ingest", "0/0", "0/0", "1d ago", "local:/demo/missing-checkout"],
    ]);
  });

  it("filters by status and limits the list", async () => {
    const failed = await repro(["status", "--status", "failed"]);
    expect(failed.out.slice(1).map((line) => line.split(/\s+/)[0])).toEqual(["run_demo_failed"]);
    const limited = await repro(["status", "--limit", "1"]);
    expect(limited.out).toHaveLength(2);
    expect((await repro(["status", "--status", "blocked"])).stdout).toBe("No blocked runs.");

    const bad = await repro(["status", "--status", "sleeping"]);
    expect(bad.code).toBe(1);
    expect(bad.err.join("\n")).toMatch(/Allowed choices are queued, running, blocked, completed, failed/);
    expect((await repro(["status", "--limit", "0"])).code).toBe(1);
    const tooMany = await repro(["status", "--limit", "201"]);
    expect(tooMany.code).toBe(1);
    expect(tooMany.err.join("\n")).toMatch(/expected a whole number from 1 to 200/);
  });

  it("shows one run's findings, diagnoses, and patches with --run or a positional ID", async () => {
    const { code, stdout, out } = await repro(["status", "--run", "run_demo_completed"]);
    expect(code).toBe(0);
    expect(out[0]).toBe("run_demo_completed  completed  stage done");
    expect(stdout).toContain("  target   local:/demo/seeded-assistant");
    expect(stdout).toContain("  started  2026-09-26T10:00:00.000Z (2h ago)");
    expect(stdout).toContain("Findings  6 flagged, 4 reproduced");
    expect(stdout).toContain("diag_demo_sqli  cites fnd_demo_sqli_owner, fnd_demo_sqli_note  [gemini-3.1-pro-preview]");
    expect(stdout).toContain("Patches  5, 3 verified");
    expect(stdout).toMatch(/patch_demo_sqli_1\s+rejected\s+tests pass · still reproduces no · regressions 0 · challenger disputed/);
    expect(stdout).toMatch(/patch_demo_prompt_logging_1\s+rejected\s+.*regressions 1/);

    // Reproduced findings first, most severe first; unconfirmed ones after.
    const findingRows = out.filter((line) => /^\s+(critical|high|medium|low|info)\s/.test(line)).map((line) => line.trim().split(/\s+/));
    expect(findingRows.map(([severity, state]) => `${severity} ${state}`)).toEqual([
      "critical reproduced",
      "high reproduced",
      "high reproduced",
      "medium reproduced",
      "medium unconfirmed",
      "low unconfirmed",
    ]);

    expect((await repro(["status", "run_demo_completed"])).stdout).toBe(stdout);
    const conflicting = await repro(["status", "run_demo_completed", "--run", "run_demo_failed"]);
    expect(conflicting.code).toBe(1);
    expect(conflicting.err).toEqual(["error: two different runs given: run_demo_completed and --run run_demo_failed"]);
  });

  it("reports an unknown run as an error", async () => {
    const { code, err, out } = await repro(["status", "--run", "run_nope"]);
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(["error: run not found: run_nope"]);
  });

  it("prints JSON for scripts", async () => {
    const list = JSON.parse((await repro(["status", "--json"])).stdout);
    expect(list).toHaveLength(4);
    expect(list[2]).toMatchObject({ run: { id: "run_demo_completed" }, counts: { findings: 6, reproducible: 4 } });
    const detail = JSON.parse((await repro(["status", "--run", "run_demo_repairing", "--json"])).stdout);
    expect(detail.patches[0]).toMatchObject({ id: "patch_demo_py_sqli_1", status: "proposed" });
  });

  it("says how to start when there are no runs", async () => {
    await app.close();
    app = buildApp(new InMemoryRunStore());
    await app.listen({ port: Number(new URL(apiUrl).port), host: "127.0.0.1" });
    expect((await repro(["status"])).stdout).toBe("No runs yet. Queue one with `repro scan <path | owner/repo>`.");
  });
});

describe("repro scan", () => {
  it("queues the current directory as an absolute local path by default", async () => {
    const { code, out } = await repro(["scan"]);
    expect(code).toBe(0);
    const runId = /^Queued (run_\S+) for local:(.+)$/.exec(out[0]!)!;
    expect(runId[2]).toBe(workdir);
    expect(out[1]).toBe(`Follow it with: repro watch ${runId[1]}`);
    expect(await store.getRun(runId[1]!)).toMatchObject({ status: "queued", stage: "ingest", trigger: "manual", target: { kind: "local", ref: workdir } });
  });

  it("keeps a revision on a local path and infers GitHub refs", async () => {
    const local = await repro(["scan", ".#main"]);
    expect(local.out[0]).toMatch(new RegExp(`for local:${workdir.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}#main$`));
    const gh = await repro(["scan", "octo/example#v2"]);
    expect(gh.code).toBe(0);
    expect(gh.out[0]).toMatch(/for github:octo\/example#v2$/);
    const url = await repro(["scan", "https://github.com/octo/example.git", "--json"]);
    expect(url.out).toHaveLength(1);
    expect(JSON.parse(url.stdout)).toMatchObject({ status: "queued", target: { kind: "github", ref: "https://github.com/octo/example.git" } });
  });

  it("refuses targets it can't place, and ones the API won't take", async () => {
    const unknown = await repro(["scan", "not-a-thing"]);
    expect(unknown.code).toBe(1);
    expect(unknown.err[0]).toMatch(/neither an existing local path nor a GitHub owner\/repo ref/);

    const missing = await repro(["scan", "./missing", "--kind", "local"]);
    expect(missing.err[0]).toBe(`error: no such local path: ${join(workdir, "missing")}`);

    const branch = await repro(["scan", "main", "--kind", "github"]);
    expect(branch.code).toBe(1);
    expect(branch.err[0]).toMatch(/^error: not a GitHub ref/);
    expect(await store.listRuns({ status: "queued" })).toHaveLength(1);
  });

  it("can follow the run it queued", async () => {
    let sleeps = 0;
    const result = await repro(["scan", "octo/example", "--watch", "--interval", "1"], {
      sleep: async () => {
        const run = (await store.listRuns({ status: "queued" })).find((r) => r.target.ref === "octo/example");
        if (++sleeps === 1 && run) await store.updateRun(run.id, { status: "failed" });
      },
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/failed at stage ingest/);
  });
});

describe("repro watch", () => {
  async function queued(): Promise<string> {
    return (await store.createRun({ target: { kind: "github", ref: "octo/example" }, trigger: "manual" })).id;
  }

  it("prints each stage change and exits 0 when the run completes", async () => {
    const runId = await queued();
    const steps = [
      () => store.updateRun(runId, { status: "running" }),
      () => store.updateRun(runId, { stage: "detect" }),
      async () => {},
      () => store.updateRun(runId, { stage: "diagnose" }),
      () => store.updateRun(runId, { stage: "done", status: "completed" }),
    ];
    let clock = NOW.getTime();
    const result = await repro(["watch", runId, "--interval", "3"], {
      now: () => new Date(clock),
      sleep: async (ms) => {
        clock += ms;
        await steps.shift()?.();
      },
    });
    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      "    0s  queued    ingest",
      "    3s  running   ingest",
      "    6s  running   detect",
      "   12s  running   diagnose",
      "   15s  completed done",
      `${runId} completed at stage done: 0 findings flagged, 0 reproduced, 0 of 0 patches verified. Details: repro status --run ${runId}`,
    ]);
  });

  it("exits 1 when the run fails, and 1 for a run that doesn't exist", async () => {
    const runId = await queued();
    const failed = await repro(["watch", "--run", runId], { sleep: async () => void (await store.updateRun(runId, { status: "failed" })) });
    expect(failed.code).toBe(1);
    expect(failed.out.at(-1)).toMatch(new RegExp(`^${runId} failed at stage ingest`));

    const missing = await repro(["watch", "run_nope"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toEqual(["error: run not found: run_nope"]);
    expect((await repro(["watch"])).err).toEqual(["error: which run? pass a run ID or --run <runId>"]);
  });

  it("exits 2 when --timeout passes with the run still in flight", async () => {
    const result = await repro(["watch", "run_demo_repairing", "--interval", "2", "--timeout", "5"]);
    expect(result.code).toBe(2);
    expect(result.out).toEqual(["    0s  running   repair"]);
    expect(result.err).toEqual(["timed out after 6s; run_demo_repairing is still running at stage repair"]);
  });

  it("rides out a few failed polls, then gives up on a dead API", async () => {
    const runId = await queued();
    const real = createApiClient(apiUrl);
    let outages = 2;
    let calls = 0;
    const serverError = TRPCClientError.from({ error: { message: "run store hiccup", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } });
    const flaky = {
      runs: {
        get: {
          query: async (input: { runId: string }) => {
            // Alternate a dropped connection and a 500, both of which are worth retrying.
            if (outages-- > 0) throw ++calls % 2 ? TRPCClientError.from(new TypeError("fetch failed")) : serverError;
            return real.runs.get.query(input);
          },
        },
        detail: real.runs.detail,
      },
    } as unknown as ApiClient;
    const survived = await repro(["watch", runId, "--timeout", "1"], { createClient: () => flaky });
    expect(survived.code).toBe(2);
    expect(survived.err.filter((line) => line.startsWith("poll failed"))).toHaveLength(2);

    outages = Infinity;
    calls = 0;
    const gaveUp = await repro(["watch", runId], { createClient: () => flaky });
    expect(gaveUp.code).toBe(1);
    expect(gaveUp.err.filter((line) => line.startsWith("poll failed"))).toHaveLength(4);
    expect(gaveUp.err.at(-1)).toMatch(/^error: can't reach the Repro API/);

    const notFound = TRPCClientError.from({ error: { message: "run not found: x", code: -32004, data: { code: "NOT_FOUND", httpStatus: 404 } } });
    const gone = { runs: { get: { query: async () => Promise.reject(notFound) } } } as unknown as ApiClient;
    const noRetry = await repro(["watch", runId], { createClient: () => gone });
    expect(noRetry.err).toEqual(["error: run not found: x"]);
  });
});

describe("repro report", () => {
  it("reports on one run, or on every run as one JSON array", async () => {
    const one = await repro(["report", "run_demo_completed"]);
    expect(one.code).toBe(0);
    expect(one.out[0]).toBe("Report: run_demo_completed");
    expect(one.stdout).toContain("6 flagged, 4 reproduced, 2 cut as noise");

    const all = await repro(["report", "--all", "--json"]);
    expect(all.code).toBe(0);
    const ids = (JSON.parse(all.stdout) as { runId: string }[]).map((report) => report.runId);
    expect(ids.sort()).toEqual(["run_demo_completed", "run_demo_failed", "run_demo_queued", "run_demo_repairing"]);
  });

  it("needs a run ID or --all, and says when the run doesn't exist", async () => {
    const bare = await repro(["report"]);
    expect(bare.code).toBe(1);
    expect(bare.err).toEqual(["error: which run? pass a run ID or --run <runId>, or --all"]);

    const missing = await repro(["report", "run_nope"]);
    expect(missing.code).toBe(1);
    expect(missing.err.join("\n")).toContain("run not found: run_nope");
  });
});

describe("repro patch", () => {
  it("records a merge on a verified patch and refuses an unverified one", async () => {
    const merged = await repro(["patch", "patch_demo_sqli_2", "merge"]);
    expect(merged).toMatchObject({ code: 0, out: ["patch_demo_sqli_2 is now merged"] });
    const proposed = await repro(["patch", "patch_demo_py_sqli_1", "merge"]);
    expect(proposed.code).toBe(1);
    expect(proposed.err[0]).toMatch(/only a verified patch can be merged or rejected/);
    expect((await repro(["patch", "patch_demo_sqli_2", "maybe"])).code).toBe(1);
  });
});

describe("the repro executable", () => {
  it("explains an unreachable API instead of crashing", async () => {
    await app.close();
    const { code, err } = await repro(["status"]);
    expect(code).toBe(1);
    expect(err[0]).toMatch(new RegExp(`^error: can't reach the Repro API at ${apiUrl.replace(/[.]/g, "\\.")} \\(.+\\)\\. Start it with`));
  });

  it("takes the API URL from REPRO_API_URL when --api isn't given", async () => {
    const out: string[] = [];
    const code = await runCli(["status", "--limit", "1"], {
      env: { REPRO_API_URL: apiUrl },
      out: (line) => out.push(line),
      err: () => {},
      color: false,
      now: () => NOW,
      sleep: async () => {},
      cwd: workdir,
    });
    expect(code).toBe(0);
    expect(out[1]).toMatch(/^run_demo_queued/);
  });

  it("prints help with exit code 0", async () => {
    const { code, stdout } = await repro(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Usage: repro/);
    expect(stdout).toMatch(/status .*\n.*scan|scan/);
  });

  it("runs as a real process through bin/repro.js", async () => {
    const bin = fileURLToPath(new URL("../bin/repro.js", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [bin, "status", "--run", "run_demo_completed"], {
      env: { ...process.env, REPRO_API_URL: apiUrl, NO_COLOR: "1" },
    });
    expect(stdout).toContain("Findings  6 flagged, 4 reproduced");

    const failure = await execFileAsync(process.execPath, [bin, "status", "--run", "run_nope"], { env: { ...process.env, REPRO_API_URL: apiUrl } }).then(
      () => null,
      (error: { code: number; stderr: string }) => error,
    );
    expect(failure?.code).toBe(1);
    expect(failure?.stderr.trim()).toBe("error: run not found: run_nope");
  }, 30_000);
});
