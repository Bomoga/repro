import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Finding, type Workspace } from "@repro/contracts";
import { DockerExecutor, installDependencies, sandboxAvailable } from "@repro/executor";
import { ingest, removeWorkspace } from "@repro/ingest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUFF_SCAN_COMMAND, parseRuffReport, ruffAdapter } from "../src/adapters/ruff.ts";
import { reproduce } from "../src/reproduce.ts";
import { DetectorError } from "../src/util.ts";
import { FakeExecutor, fixture, seededWorkspace } from "./helpers.ts";

describe("ruff adapter", () => {
  it("maps Bandit's S rules to vulnerabilities and bugbear's B rules to correctness", () => {
    const findings = parseRuffReport(fixture("ruff.json"), seededWorkspace);
    expect(findings.map((f) => [f.ruleId, f.file, f.lineStart, f.category, f.severity])).toEqual([
      ["S602", "app/jobs.py", 5, "vulnerability", "medium"],
      ["B006", "app/jobs.py", 8, "correctness", "low"],
    ]);
    for (const f of findings) {
      Finding.parse(f);
      expect(f).toMatchObject({ detectorId: "ruff", reproducible: false });
      expect(f.reproductionCommand).toBe(`repro-ruff-rule '${f.ruleId}' 'app/jobs.py'`);
    }
    expect(findings[1]!.evidence).toBe("def queue(job, pending=[]):");
  });

  it("runs isolated from the target's own config and noqa comments", async () => {
    expect(RUFF_SCAN_COMMAND).toContain("--select S,B");
    expect(RUFF_SCAN_COMMAND).toContain("--isolated");
    expect(RUFF_SCAN_COMMAND).toContain("--ignore-noqa");
    const exec = new FakeExecutor(() => ({ stdout: fixture("ruff.json") }));
    expect(await ruffAdapter.run(seededWorkspace, exec)).toHaveLength(2);
    expect(exec.requests[0]!.command).toBe(RUFF_SCAN_COMMAND);
  });

  it("skips projects with no Python, and treats a failed scan as an error", async () => {
    const exec = new FakeExecutor(() => ({ stdout: "[]" }));
    expect(await ruffAdapter.run({ ...seededWorkspace, languages: ["javascript"] }, exec)).toEqual([]);
    expect(exec.requests).toHaveLength(0);
    const broken = new FakeExecutor(() => ({ exitCode: 2, stderr: "ruff: error" }));
    await expect(ruffAdapter.run(seededWorkspace, broken)).rejects.toBeInstanceOf(DetectorError);
  });
});

// Review of PR #22, bug 3: the Executor put /workspace/.repro/venv/bin first on PATH whenever that
// folder existed, so a target that committed its own .repro/venv/bin/ruff decided what `ruff` meant,
// and its scan came back empty.
const ready = await sandboxAvailable();

describe.skipIf(!ready)("a target that commits its own .repro/venv (sandbox)", () => {
  const exec = new DockerExecutor();
  let source: string;
  let workspace: Workspace;

  beforeAll(async () => {
    source = mkdtempSync(join(tmpdir(), "repro-shadow-"));
    const write = (file: string, text: string, mode = 0o644) => {
      mkdirSync(dirname(join(source, file)), { recursive: true });
      writeFileSync(join(source, file), text, { mode });
    };
    write("app.py", "import subprocess\n\n\ndef run(cmd):\n    return subprocess.call(cmd, shell=True)\n");
    // A stand-in ruff that reports nothing, and a whole fake venv around it: its own python and the
    // install step's marker, neither of which Repro's install step ever wrote.
    write(".repro/venv/bin/ruff", "#!/bin/sh\necho '[]'\n", 0o755);
    write(".repro/venv/bin/python", "#!/bin/sh\necho FAKE-PYTHON\n", 0o755);
    write(".repro/venv.json", '{"venv": ".repro/venv"}\n');
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: source });
    git("init", "-q");
    git("add", "-A", "--force");
    git("commit", "-qm", "seed");
    workspace = await ingest(`shadow-${Date.now()}`, { kind: "local", ref: source });
  }, 60_000);

  afterAll(() => {
    if (workspace) removeWorkspace(workspace);
    rmSync(source, { recursive: true, force: true });
  });

  it("still finds and reproduces the real issue with the sandbox's own ruff", async () => {
    expect(workspace.fileIndex).toEqual(expect.arrayContaining([".repro/venv/bin/ruff", ".repro/venv/bin/python", ".repro/venv.json"]));
    const which = await exec.exec({ workspacePath: workspace.path, command: "command -v ruff; command -v python3", timeoutMs: 60_000 });
    expect(which.stdout.trim().split("\n")).toEqual(["/usr/local/bin/ruff", "/usr/local/bin/python3"]);

    const findings = await ruffAdapter.run(workspace, exec);
    expect(findings.map((f) => [f.ruleId, f.file, f.lineStart, f.reproducible])).toEqual([["S602", "app.py", 5, false]]);
    const { findings: reproduced } = await reproduce(findings, workspace, exec);
    expect(reproduced[0]!.reproducible).toBe(true);
    expect(reproduced[0]!.reproductionOutput).toMatch(/^REPRODUCED ruff S602 at app\.py:5-5: /);
  }, 120_000);

  it("never runs the target's code under the committed venv, or installs into it", async () => {
    const py = await exec.exec({ workspacePath: workspace.path, command: 'repro-python -c "import sys; print(sys.executable)"', timeoutMs: 60_000 });
    expect(py.exitCode).toBe(0);
    expect(py.stdout.trim()).toBe("/usr/local/bin/python3");

    const report = await installDependencies(workspace);
    expect(report).toEqual({ cached: false, steps: [], skipped: [expect.stringMatching(/^\.repro\/: the target commits files there/)] });
    // Nothing was written into the target's own .repro/.
    expect(execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: workspace.path, encoding: "utf8" })).toBe("");
  }, 120_000);
});
