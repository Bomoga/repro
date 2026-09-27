import type { Finding } from "@repro/contracts";
import { ExecutorError } from "@repro/executor";
import { describe, expect, it } from "vitest";
import { reproduce } from "../src/reproduce.ts";
import { FakeExecutor, seededWorkspace } from "./helpers.ts";

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "fnd_1",
  detectorId: "semgrep",
  ruleId: "rule.x",
  severity: "high",
  category: "vulnerability",
  file: "server/index.js",
  lineStart: 6,
  lineEnd: 6,
  message: "m",
  evidence: "e",
  reproducible: false,
  reproductionCommand: "repro-semgrep-rule 'registry' 'rule.x' 'server/index.js'",
  createdAt: "2026-09-26T00:00:00.000Z",
  ...over,
});

const REPRODUCED = "REPRODUCED semgrep rule.x at server/index.js:6-6: direct response write\n";

describe("reproduce", () => {
  it("flips reproducible and records the output when the command demonstrates the issue", async () => {
    const exec = new FakeExecutor(() => ({ exitCode: 1, stdout: REPRODUCED }));
    const { findings, attempts } = await reproduce([finding()], seededWorkspace, exec);
    expect(findings[0]).toMatchObject({ reproducible: true, reproductionOutput: REPRODUCED.trimEnd() });
    expect(attempts[0]).toMatchObject({ outcome: "reproduced", exitCode: 1 });
    expect(exec.requests[0]).toMatchObject({
      workspacePath: seededWorkspace.path,
      command: "repro-semgrep-rule 'registry' 'rule.x' 'server/index.js'",
    });
  });

  it("leaves a Finding without a reproductionCommand unconfirmed, without running anything", async () => {
    const exec = new FakeExecutor(() => ({ exitCode: 1, stdout: REPRODUCED }));
    const { findings, attempts } = await reproduce([finding({ reproductionCommand: undefined })], seededWorkspace, exec);
    expect(findings[0]!.reproducible).toBe(false);
    expect(attempts[0]!.outcome).toBe("no-command");
    expect(exec.requests).toHaveLength(0);
  });

  it.each([
    ["the rule no longer fires", { exitCode: 0, stdout: "NOT REPRODUCED semgrep rule.x in server/index.js" }, "not-reproduced"],
    ["the helper couldn't decide", { exitCode: 2, stderr: "unknown rule" }, "undecided"],
    ["the command timed out", { exitCode: 137, timedOut: true, stdout: REPRODUCED }, "undecided"],
    ["it matched somewhere else in the file", { exitCode: 1, stdout: "REPRODUCED semgrep rule.x at server/index.js:60-60: m" }, "undecided"],
    ["exit 1 without the protocol line", { exitCode: 1, stdout: "Traceback (most recent call last)" }, "undecided"],
  ])("stays unconfirmed when %s", async (_why, result, outcome) => {
    const { findings, attempts } = await reproduce([finding()], seededWorkspace, new FakeExecutor(() => result));
    expect(findings[0]!.reproducible).toBe(false);
    expect(findings[0]!.reproductionOutput).toBeUndefined();
    expect(attempts[0]!.outcome).toBe(outcome);
  });

  it("stays unconfirmed when the sandbox itself fails", async () => {
    const exec = new FakeExecutor(() => {
      throw new ExecutorError("daemon down");
    });
    const { findings, attempts } = await reproduce([finding()], seededWorkspace, exec);
    expect(findings[0]!.reproducible).toBe(false);
    expect(attempts[0]).toMatchObject({ outcome: "undecided", error: "daemon down" });
  });

  it("discards any reproductionOutput it didn't write itself", async () => {
    const exec = new FakeExecutor(() => ({ exitCode: 0 }));
    const { findings } = await reproduce([finding({ reproducible: true, reproductionOutput: "forged" })], seededWorkspace, exec);
    expect(findings[0]).not.toHaveProperty("reproductionOutput");
    expect(findings[0]!.reproducible).toBe(false);
  });

  it("redacts and bounds the recorded output", async () => {
    const secret = `ghp_${"z".repeat(36)}`;
    const exec = new FakeExecutor(() => ({ exitCode: 1, stdout: `${REPRODUCED}${secret}\n${"x".repeat(10_000)}` }));
    const { findings } = await reproduce([finding()], seededWorkspace, exec);
    expect(findings[0]!.reproductionOutput).not.toContain(secret);
    expect(findings[0]!.reproductionOutput!.length).toBeLessThan(4100);
  });

  it("keeps results in input order under concurrency", async () => {
    const many = Array.from({ length: 7 }, (_, i) => finding({ id: `fnd_${i}`, lineStart: i + 1 }));
    const exec = new FakeExecutor(async (req) => {
      await new Promise((r) => setTimeout(r, Math.random() * 20));
      return { exitCode: 0, stdout: req.command };
    });
    const { findings } = await reproduce(many, seededWorkspace, exec, { concurrency: 3 });
    expect(findings.map((f) => f.id)).toEqual(many.map((f) => f.id));
  });

  it("runs canary reproductions alone, after the rest, so their workspace reads can't interfere", async () => {
    let running = 0;
    const log: string[] = [];
    const exec = new FakeExecutor(async (req) => {
      running++;
      if (req.command.startsWith("repro-canary")) log.push(`canary alone=${running === 1}`);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return { exitCode: 0 };
    });
    const mixed = [
      finding({ id: "a", reproductionCommand: "repro-canary 'prompt-logging' 'x.py' 'f' '1'" }),
      finding({ id: "b" }),
      finding({ id: "c", reproductionCommand: "repro-canary 'prompt-logging' 'y.py' 'g' '1'" }),
      finding({ id: "d" }),
    ];
    const { findings } = await reproduce(mixed, seededWorkspace, exec, { concurrency: 4 });
    expect(findings.map((f) => f.id)).toEqual(["a", "b", "c", "d"]);
    expect(log).toEqual(["canary alone=true", "canary alone=true"]);
    expect(exec.requests.map((r) => r.command.startsWith("repro-canary"))).toEqual([false, false, true, true]);
  });
});
