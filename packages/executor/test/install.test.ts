import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Workspace } from "@repro/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACES_ROOT, DockerExecutor, VENV_MARKER, installDependencies, planInstall, sandboxAvailable } from "../src/index.ts";

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

  it("installs nothing, and writes nothing, when the target commits files under .repro/", async () => {
    const ws = workspace({ "requirements.txt": "six==1.16.0", ".repro/venv.json": '{"venv": ".repro/venv"}' });
    const plan = planInstall(ws);
    expect(plan.pip).toBeUndefined();
    expect(plan.skipped).toEqual([expect.stringMatching(/^\.repro\/: the target commits files there/)]);
    // Returns before touching Docker or the workspace.
    const report = await installDependencies(ws, { dockerBin: "/nonexistent/docker" });
    expect(report).toEqual({ cached: false, steps: [], skipped: plan.skipped });
    expect(execFileSync("find", [join(ws.path, ".repro")], { encoding: "utf8" }).trim().split("\n")).toEqual([
      join(ws.path, ".repro"),
      join(ws.path, ".repro", "venv.json"),
    ]);
  });
});

// When repro-python runs the target's Python under the venv in .repro/, and when it won't. Offline:
// each venv is a minimal one (pyvenv.cfg and a python that points at the sandbox's own), laid out on
// the host with the install step's marker the way installDependencies writes it, before any container
// looks at the workspace.
const sandbox = await sandboxAvailable();

describe.skipIf(!sandbox)("repro-python and the install step's venv (sandbox)", () => {
  const exec = new DockerExecutor();
  const repos: string[] = [];
  afterAll(() => repos.forEach((path) => rmSync(path, { recursive: true, force: true })));

  interface Layout {
    committed?: Record<string, string>;
    untracked?: Record<string, string>;
    venv?: boolean;
    git?: boolean;
  }
  const repo = ({ committed = { "app.py": "print('hi')\n" }, untracked = {}, venv = true, git = true }: Layout): string => {
    mkdirSync(DEFAULT_WORKSPACES_ROOT, { recursive: true });
    const path = mkdtempSync(join(DEFAULT_WORKSPACES_ROOT, "venv-test-"));
    repos.push(path);
    const write = (files: Record<string, string>) => {
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(dirname(join(path, file)), { recursive: true });
        writeFileSync(join(path, file), text, { mode: file.includes("/bin/") ? 0o755 : 0o644 });
      }
    };
    write(committed);
    if (git) {
      const run = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: path });
      run("init", "-q");
      run("add", "-A", "--force");
      run("commit", "-qm", "seed");
    }
    if (venv) {
      mkdirSync(join(path, ".repro", "venv", "bin"), { recursive: true });
      writeFileSync(join(path, ".repro", "venv", "pyvenv.cfg"), "home = /usr/local/bin\ninclude-system-site-packages = false\n");
      symlinkSync("/usr/local/bin/python3", join(path, ".repro", "venv", "bin", "python"));
    }
    write(untracked);
    return path;
  };
  const marker = { [VENV_MARKER]: JSON.stringify({ venv: ".repro/venv", requirements: ["requirements.txt"] }) };
  const prefix = async (path: string) => {
    const r = await exec.exec({ workspacePath: path, command: 'repro-python -c "import sys; print(sys.prefix)"', timeoutMs: 60_000 });
    expect(r.exitCode).toBe(0);
    return r.stdout.trim();
  };

  it("runs the target's Python under the venv the install step built, and never puts it on PATH", async () => {
    // A venv whose dependencies include a ruff of the target's own choosing (a requirements-dev.txt with ruff in it).
    const path = repo({ untracked: { ...marker, ".repro/venv/bin/ruff": "#!/bin/sh\necho '[]'\n" } });
    expect(await prefix(path)).toBe("/workspace/.repro/venv");
    const which = await exec.exec({ workspacePath: path, command: "command -v ruff; command -v python3; echo \"$VIRTUAL_ENV\"", timeoutMs: 60_000 });
    expect(which.stdout.split("\n").slice(0, 3)).toEqual(["/usr/local/bin/ruff", "/usr/local/bin/python3", ""]);
  }, 120_000);

  it("won't use a venv the install step didn't mark as built", async () => {
    expect(await prefix(repo({}))).toBe("/usr/local");
    // The install step blanks the marker while it rebuilds.
    expect(await prefix(repo({ untracked: { [VENV_MARKER]: "{}\n" } }))).toBe("/usr/local");
  }, 120_000);

  it("won't use a venv when anything under .repro/ is part of the target's commit", async () => {
    // The marker itself committed, next to an untracked venv...
    expect(await prefix(repo({ committed: { "app.py": "", ...marker } }))).toBe("/usr/local");
    // ...or any other file under .repro/, next to an untracked marker.
    expect(await prefix(repo({ committed: { "app.py": "", ".repro/notes.txt": "x" }, untracked: marker }))).toBe("/usr/local");
    // Without git there's no telling what the target shipped, so no trust either.
    expect(await prefix(repo({ git: false, untracked: marker }))).toBe("/usr/local");
  }, 120_000);
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
    const load = `node -e "console.log(require('is-number')(3))" && repro-python -c "import six; print(six.__version__)"`;
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
    // Only through repro-python: the sandbox's own python3 never sees the target's dependencies.
    expect((await exec.exec({ workspacePath: ws.path, command: 'python3 -c "import six"', timeoutMs: 60_000 })).exitCode).not.toBe(0);
    expect((await installDependencies(ws)).cached).toBe(true);
  }, 300_000);

  it("runs the target's own pytest from the venv it installed", async () => {
    const ws = repo({
      "requirements.txt": "pytest==8.3.3\n",
      "test_math.py": "def test_add():\n    assert 1 + 1 == 3\n",
    });
    expect((await installDependencies(ws)).steps.every((s) => s.ok)).toBe(true);
    const scan = await exec.exec({ workspacePath: ws.path, command: "repro-test scan", timeoutMs: 300_000 });
    expect(scan.exitCode).toBe(0);
    expect(JSON.parse(scan.stdout)).toEqual([expect.objectContaining({ kind: "pytest", id: "test_math.py::test_add", file: "test_math.py" })]);
    const check = await exec.exec({ workspacePath: ws.path, command: "repro-test check pytest test_math.py 1 test_math.py::test_add", timeoutMs: 300_000 });
    expect(check.exitCode).toBe(1);
    expect(check.stdout).toMatch(/^REPRODUCED tests test_math\.py::test_add at test_math\.py:1-1/);
  }, 300_000);

  it("can't reach anything but the registries", async () => {
    const ws = repo({ "requirements.txt": "six @ https://github.com/benjaminp/six/archive/refs/tags/1.16.0.zip\n" });
    const report = await installDependencies(ws);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0]).toMatchObject({ ecosystem: "pip", phase: "download", ok: false });
    expect(report.steps[0]!.output).toMatch(/ProxyError|403|Tunnel connection failed/);
  }, 300_000);
});
