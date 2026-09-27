import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecResult, Workspace } from "@repro/contracts";
import {
  DEFAULT_SANDBOX_IMAGE,
  DockerExecutor,
  ExecutorError,
  REPRO_DIR,
  VENV_DIR,
  buildDockerArgs,
  resolveWorkspacePath,
  runContainer,
  type DockerExecutorOptions,
} from "./docker-executor.ts";

// Installing the target's own dependencies, so its tests, its modules, and anything else that
// runs its code in the sandbox can actually load (Express, pytest, ...).
//
// This is the one sandboxed step that gets any network, and only in two narrow halves:
// - download: `npm ci --ignore-scripts` / `pip download --only-binary=:all:` in a container on an
//   internal Docker network whose only way out is repro-registry-proxy, which tunnels to the npm
//   and PyPI registries and nothing else. npm install scripts are skipped and pip takes only prebuilt
//   wheels from the index, but this half isn't free of target code: a requirements line naming a
//   local directory (`./pkg`) makes pip run that package's build backend to read its metadata. That
//   code can reach only the registries, and the container holds nothing but the workspace itself.
// - build: `npm rebuild` (the install scripts) and the venv install from the downloaded wheels,
//   through the ordinary Executor, with no network at all.
//
// Everything lands in the workspace: node_modules/ where Node looks for it, the Python venv and
// caches under .repro/, which ignores itself in git. Lane 3's Repair and Challenger work in the same
// workspace (reset with `git reset --hard`, which leaves untracked files alone), so they see it too.
// The venv is never on PATH: Python that should see the target's dependencies runs through
// `repro-python` (e.g. `repro-python -m pytest`), which uses the venv only once VENV_MARKER says this
// step built it.

export interface InstallStep {
  ecosystem: "npm" | "pip";
  phase: "download" | "build";
  command: string;
  ok: boolean;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  /** The last part of the command's output. */
  output: string;
}

export interface InstallReport {
  /** True when the workspace already had these exact dependencies installed. */
  cached: boolean;
  steps: InstallStep[];
  /** Manifests found but not installed, and why. */
  skipped: string[];
}

export interface InstallOptions extends DockerExecutorOptions {
  timeoutMs?: number;
  /** Hosts the proxy may reach. Default: the npm and PyPI registries. */
  registryHosts?: string[];
}

const MARKER = `${REPRO_DIR}/deps.json`;
/**
 * Written only once the install step has built the venv. It, and nothing under .repro/ being part of
 * the target's own commit, is what makes `repro-python` trust the venv (sandbox/bin/repro_venv.py).
 */
export const VENV_MARKER = `${REPRO_DIR}/venv.json`;
const NPM_CACHE = `${REPRO_DIR}/npm-cache`;
const WHEELS = `${REPRO_DIR}/wheels`;
const REQUIREMENTS = /^requirements(-(dev|test|tests))?\.txt$/;
const OUTPUT_TAIL = 2_000;
const PROXY_PORT = 3128;

interface Plan {
  npm?: { lockfile: boolean };
  pip?: { files: string[] };
  skipped: string[];
  /** The target commits files under .repro/: nothing gets installed or written there. */
  reproDirTaken?: true;
}

/** What to install, from the ingest-time file index and the root package.json. */
export function planInstall(workspace: Workspace): Plan {
  const index = new Set(workspace.fileIndex);
  const plan: Plan = { skipped: [] };

  // .repro/ is Repro's scratch space. A target that commits files there (a whole fake venv, say)
  // doesn't get it mixed with Repro's own: nothing is installed, and nothing there is trusted.
  if (workspace.fileIndex.some((file) => file.startsWith(`${REPRO_DIR}/`))) {
    return { skipped: [`${REPRO_DIR}/: the target commits files there, where Repro installs dependencies; nothing was installed`], reproDirTaken: true };
  }

  if (index.has("package.json")) {
    let deps = 0;
    try {
      const pkg = JSON.parse(readFileSync(join(workspace.path, "package.json"), "utf8"));
      for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) deps += Object.keys(pkg[key] ?? {}).length;
    } catch {
      plan.skipped.push("package.json: not valid JSON");
    }
    if (deps > 0) plan.npm = { lockfile: index.has("package-lock.json") || index.has("npm-shrinkwrap.json") };
    if (deps > 0 && !plan.npm?.lockfile && (index.has("yarn.lock") || index.has("pnpm-lock.yaml"))) {
      plan.skipped.push("yarn.lock/pnpm-lock.yaml: not read; installed from package.json's version ranges with npm");
    }
  }

  const requirements = workspace.fileIndex.filter((file) => REQUIREMENTS.test(file)).sort();
  if (requirements.length > 0) plan.pip = { files: requirements };
  else if (index.has("pyproject.toml") || index.has("Pipfile")) {
    plan.skipped.push("pyproject.toml/Pipfile: only requirements*.txt files are installed");
  }
  return plan;
}

function fingerprint(workspace: Workspace, plan: Plan): string {
  const hash = createHash("sha256").update(JSON.stringify(plan));
  for (const file of ["package.json", "package-lock.json", "npm-shrinkwrap.json", ...(plan.pip?.files ?? [])]) {
    const path = join(workspace.path, file);
    if (existsSync(path)) hash.update(file).update(readFileSync(path));
  }
  return hash.digest("hex");
}

function tail(result: ExecResult): string {
  const text = `${result.stdout}\n${result.stderr}`.trim();
  return text.length <= OUTPUT_TAIL ? text : `…${text.slice(-OUTPUT_TAIL)}`;
}

function docker(bin: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("error", (err) => resolve({ code: -1, out: err.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

/**
 * Brings up an internal network plus the registry proxy, runs `commands` in containers on that
 * network, and always tears both down again.
 */
async function withRegistryNetwork<T>(
  options: InstallOptions,
  run: (network: string, env: Record<string, string>) => Promise<T>,
): Promise<T> {
  const bin = options.dockerBin ?? "docker";
  const id = randomUUID().slice(0, 12);
  const network = `repro-install-${id}`;
  const proxy = `repro-registry-proxy-${id}`;
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  try {
    const created = await docker(bin, ["network", "create", "--internal", network]);
    if (created.code !== 0) throw new ExecutorError(`could not create the install network: ${created.out.trim()}`);
    const started = await docker(bin, [
      "run", "-d", "--rm", "--name", proxy,
      "--network", "bridge",
      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--user", `${uid}:${gid}`, "--memory", "256m", "--pids-limit", "64",
      ...(options.registryHosts ? ["--env", `REPRO_REGISTRY_ALLOW=${options.registryHosts.join(",")}`] : []),
      options.image ?? DEFAULT_SANDBOX_IMAGE,
      "repro-registry-proxy", String(PROXY_PORT),
    ]);
    if (started.code !== 0) throw new ExecutorError(`could not start the registry proxy: ${started.out.trim()}`);
    const connected = await docker(bin, ["network", "connect", network, proxy]);
    if (connected.code !== 0) throw new ExecutorError(`could not attach the registry proxy: ${connected.out.trim()}`);
    for (let i = 0; ; i++) {
      if ((await docker(bin, ["logs", proxy])).out.includes("listening")) break;
      if (i >= 50) throw new ExecutorError("the registry proxy never came up");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const url = `http://${proxy}:${PROXY_PORT}`;
    return await run(network, {
      HTTPS_PROXY: url,
      HTTP_PROXY: url,
      https_proxy: url,
      http_proxy: url,
      npm_config_https_proxy: url,
      npm_config_proxy: url,
    });
  } finally {
    await docker(bin, ["rm", "-f", proxy]);
    await docker(bin, ["network", "rm", network]);
  }
}

/**
 * Installs the workspace's npm and pip dependencies once. Safe to call again: a marker under
 * .repro/ records what was installed, and an unchanged workspace returns the recorded report.
 */
export async function installDependencies(workspace: Workspace, options: InstallOptions = {}): Promise<InstallReport> {
  const root = resolveWorkspacePath(workspace.path);
  const plan = planInstall(workspace);
  // Before reading or writing anything under .repro/: it's the target's, not Repro's.
  if (plan.reproDirTaken) return { cached: false, steps: [], skipped: plan.skipped };
  const print = fingerprint(workspace, plan);
  const marker = join(root, MARKER);
  if (existsSync(marker)) {
    try {
      const saved = JSON.parse(readFileSync(marker, "utf8")) as { fingerprint: string; report: InstallReport };
      if (saved.fingerprint === print) return { ...saved.report, cached: true };
    } catch {
      // A corrupt marker just means installing again.
    }
  }

  mkdirSync(join(root, REPRO_DIR), { recursive: true });
  writeFileSync(join(root, REPRO_DIR, ".gitignore"), "*\n");
  // Trusted again only if this install builds the venv. Overwritten in place, never deleted and
  // re-created: Docker Desktop/Colima file sharing can serve a container a re-created file stale.
  if (existsSync(join(root, VENV_MARKER))) writeFileSync(join(root, VENV_MARKER), "{}\n");
  const report: InstallReport = { cached: false, steps: [], skipped: plan.skipped };
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const maxOutput = options.maxOutputBytes ?? 8 * 1024 * 1024;
  const record = (ecosystem: InstallStep["ecosystem"], phase: InstallStep["phase"], command: string, result: ExecResult) =>
    report.steps.push({
      ecosystem,
      phase,
      command,
      ok: !result.timedOut && result.exitCode === 0,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      output: tail(result),
    });

  const downloads: { ecosystem: InstallStep["ecosystem"]; command: string }[] = [];
  if (plan.npm) {
    const flags = `--ignore-scripts --no-audit --no-fund --loglevel=error --cache ${NPM_CACHE}`;
    downloads.push({
      ecosystem: "npm",
      command: plan.npm.lockfile ? `npm ci ${flags}` : `npm install ${flags} --no-package-lock`,
    });
  }
  if (plan.pip) {
    const reqs = plan.pip.files.map((file) => `-r '${file}'`).join(" ");
    downloads.push({
      ecosystem: "pip",
      command: `python3 -m pip download --only-binary=:all: --dest ${WHEELS} --no-cache-dir --progress-bar off --disable-pip-version-check ${reqs}`,
    });
  }

  if (downloads.length > 0) {
    await withRegistryNetwork(options, async (network, env) => {
      for (const { ecosystem, command } of downloads) {
        const name = `repro-install-${randomUUID()}`;
        const args = buildDockerArgs({ workspacePath: root, command, timeoutMs }, name, options, { network, env });
        record(ecosystem, "download", command, await runContainer(options.dockerBin ?? "docker", args, name, timeoutMs, maxOutput));
      }
    });
  }

  const offline = new DockerExecutor(options);
  const downloaded = (ecosystem: InstallStep["ecosystem"]) =>
    report.steps.some((step) => step.ecosystem === ecosystem && step.phase === "download" && step.ok);
  if (plan.npm && downloaded("npm")) {
    const command = "npm rebuild --no-audit --no-fund --loglevel=error";
    record("npm", "build", command, await offline.exec({ workspacePath: root, command, timeoutMs }));
  }
  if (plan.pip && downloaded("pip")) {
    const reqs = plan.pip.files.map((file) => `-r '${file}'`).join(" ");
    const command = `python3 -m venv ${VENV_DIR} && ${VENV_DIR}/bin/python -m pip install --no-index --find-links ${WHEELS} --disable-pip-version-check --progress-bar off ${reqs}`;
    const result = await offline.exec({ workspacePath: root, command, timeoutMs });
    record("pip", "build", command, result);
    if (!result.timedOut && result.exitCode === 0) {
      writeFileSync(join(root, VENV_MARKER), JSON.stringify({ venv: VENV_DIR, requirements: plan.pip.files }, null, 2));
    }
  }

  writeFileSync(marker, JSON.stringify({ fingerprint: print, report }, null, 2));
  return report;
}
