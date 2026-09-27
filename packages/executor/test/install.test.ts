import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Workspace } from "@repro/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { DockerExecutor, installDependencies, planInstall, sandboxAvailable } from "../src/index.ts";

const workspace = (files: Record<string, string>): Workspace => {
  const path = mkdtempSync(join(tmpdir(), "repro-plan-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    writeFileSync(join(path, file), text);
  }
  return { runId: "r", path, fileIndex: Object.keys(files), languages: [], headCommit: "0".repeat(40) };
};

describe("planInstall", () => {
  it("installs npm dependencies with the lockfile when there is one", () => {
    expect(planInstall(workspace({ "package.json": '{"dependencies":{"a":"1"}}', "package-lock.json": "{}" })).npm).toEqual({ lockfile: true });
    expect(planInstall(workspace({ "package.json": '{"devDependencies":{"a":"1"}}' })).npm).toEqual({ lockfile: false });
  });

  it("skips a package.json with nothing to install", () => {
    expect(planInstall(workspace({ "package.json": '{"scripts":{"test":"node --test"}}' })).npm).toBeUndefined();
  });

  it("installs the root requirements files, and says what it doesn't install", () => {
    const plan = planInstall(workspace({ "requirements.txt": "six==1.16.0", "requirements-dev.txt": "", "docs/requirements.txt": "" }));
    expect(plan.pip).toEqual({ files: ["requirements-dev.txt", "requirements.txt"] });
    expect(planInstall(workspace({ "pyproject.toml": "" })).skipped[0]).toMatch(/pyproject/);
  });
});

// Real installs reach the npm and PyPI registries through the proxy; opt in with REPRO_NETWORK_TESTS=1.
const ready = Boolean(process.env.REPRO_NETWORK_TESTS) && (await sandboxAvailable());

describe.skipIf(!ready)("installDependencies (network, sandbox)", () => {
  const exec = new DockerExecutor();
  const repos: string[] = [];
  const repo = (files: Record<string, string>): Workspace => {
    const path = mkdtempSync(join(process.env.HOME!, ".repro", "workspaces", "install-test-"));
    repos.push(path);
    for (const [file, text] of Object.entries(files)) writeFileSync(join(path, file), text);
    execFileSync("git", ["init", "-q"], { cwd: path });
    return { runId: "r", path, fileIndex: Object.keys(files), languages: [], headCommit: "0".repeat(40) };
  };
  afterAll(() => repos.forEach((path) => rmSync(path, { recursive: true, force: true })));

  it("installs npm and pip dependencies that then load with no network", async () => {
    const ws = repo({
      "package.json": JSON.stringify({ name: "t", dependencies: { "is-number": "7.0.0" } }),
      "requirements.txt": "six==1.16.0\n",
    });
    const load = `node -e "console.log(require('is-number')(3))" && python3 -c "import six; print(six.__version__)"`;
    expect((await exec.exec({ workspacePath: ws.path, command: load, timeoutMs: 60_000 })).exitCode).not.toBe(0);

    const report = await installDependencies(ws);
    expect(report.steps.map((s) => [s.ecosystem, s.phase, s.ok])).toEqual([
      ["npm", "download", true],
      ["pip", "download", true],
      ["npm", "build", true],
      ["pip", "build", true],
    ]);
    const after = await exec.exec({ workspacePath: ws.path, command: load, timeoutMs: 60_000 });
    expect(after.stdout.trim().split("\n")).toEqual(["true", "1.16.0"]);
    expect((await installDependencies(ws)).cached).toBe(true);
  }, 300_000);

  it("can't reach anything but the registries", async () => {
    const ws = repo({ "requirements.txt": "six @ https://github.com/benjaminp/six/archive/refs/tags/1.16.0.zip\n" });
    const report = await installDependencies(ws);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0]).toMatchObject({ ecosystem: "pip", phase: "download", ok: false });
    expect(report.steps[0]!.output).toMatch(/ProxyError|403|Tunnel connection failed/);
  }, 300_000);
});
