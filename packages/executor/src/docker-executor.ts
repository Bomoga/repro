import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { ExecRequest, type ExecResult, type Executor } from "@repro/contracts";

// The image every sandboxed command runs in (sandbox/Dockerfile). Built locally with
// `npm run sandbox:build`; override with REPRO_SANDBOX_IMAGE.
export const DEFAULT_SANDBOX_IMAGE = process.env.REPRO_SANDBOX_IMAGE ?? "repro-sandbox:dev";

// Where the workspace is mounted inside the container. Commands run with this as their cwd, so
// Finding.file paths (relative to Workspace.path) resolve unchanged inside the sandbox.
export const CONTAINER_WORKSPACE = "/workspace";

// Repro's own scratch space inside a workspace (self-gitignored; see install.ts), and the Python
// virtualenv the dependency-install step creates there. Once it exists, every command runs with it
// first on PATH, so `python -m pytest` and friends see the target's own dependencies.
export const REPRO_DIR = ".repro";
export const VENV_DIR = `${REPRO_DIR}/venv`;
const SANDBOX_PATH = "/opt/repro/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** Per-container differences from the default sandbox. Nothing but install.ts sets `network`. */
export interface ContainerOverrides {
  network?: string;
  env?: Record<string, string>;
}

export interface DockerExecutorOptions {
  image?: string;
  memory?: string;
  cpus?: string;
  pidsLimit?: number;
  tmpfsSize?: string;
  // Per-stream cap. Past it the stream is cut and a marker is appended to stderr, so a runaway
  // command can't exhaust the host's memory.
  maxOutputBytes?: number;
  dockerBin?: string;
}

// Thrown when the sandbox itself couldn't run the command (daemon down, image missing, bad
// workspace path). Distinct from the command's own non-zero exit, which is returned, not thrown.
export class ExecutorError extends Error {
  override name = "ExecutorError";
}

const KILL_GRACE_MS = 5_000;

export function buildDockerArgs(
  request: ExecRequest,
  containerName: string,
  options: DockerExecutorOptions = {},
  overrides: ContainerOverrides = {},
): string[] {
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const env = Object.entries({ HOME: "/tmp", ...overrides.env }).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    // Section 9: ephemeral and network-restricted. No network at all, a read-only root
    // filesystem, no capabilities, no privilege escalation, bounded pids/memory/cpu.
    "--network",
    overrides.network ?? "none",
    "--read-only",
    "--tmpfs",
    `/tmp:rw,exec,nosuid,size=${options.tmpfsSize ?? "1g"}`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    String(options.pidsLimit ?? 512),
    "--memory",
    options.memory ?? process.env.REPRO_SANDBOX_MEMORY ?? "3g",
    "--cpus",
    options.cpus ?? process.env.REPRO_SANDBOX_CPUS ?? "2",
    "--user",
    `${uid}:${gid}`,
    ...env,
    "--mount",
    `type=bind,src=${request.workspacePath},dst=${CONTAINER_WORKSPACE}`,
    "--workdir",
    CONTAINER_WORKSPACE,
    options.image ?? DEFAULT_SANDBOX_IMAGE,
    "sh",
    "-c",
    request.command,
  ];
}

export function resolveWorkspacePath(workspacePath: string): string {
  if (!isAbsolute(workspacePath)) {
    throw new ExecutorError(`workspacePath must be absolute: ${workspacePath}`);
  }
  let resolved: string;
  try {
    resolved = realpathSync(workspacePath);
  } catch {
    throw new ExecutorError(`workspacePath does not exist: ${workspacePath}`);
  }
  if (!statSync(resolved).isDirectory()) {
    throw new ExecutorError(`workspacePath is not a directory: ${workspacePath}`);
  }
  // --mount uses commas as separators; refuse rather than risk a mis-parsed mount.
  if (resolved.includes(",")) {
    throw new ExecutorError(`workspacePath may not contain a comma: ${workspacePath}`);
  }
  return resolved;
}

class CappedBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  truncated = false;

  constructor(private readonly max: number) {}

  push(chunk: Buffer): void {
    if (this.size >= this.max) {
      this.truncated = true;
      return;
    }
    const room = this.max - this.size;
    const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
    if (kept.length < chunk.length) this.truncated = true;
    this.chunks.push(kept);
    this.size += kept.length;
  }

  toString(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

/**
 * Runs one `docker run` to completion and collects its output: the shared core of every sandboxed
 * command. On timeout the container itself is killed, not just the docker CLI.
 */
export function runContainer(
  docker: string,
  args: string[],
  containerName: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<ExecResult> {
  const started = performance.now();
  const stdout = new CappedBuffer(maxOutputBytes);
  const stderr = new CappedBuffer(maxOutputBytes);

  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(docker, args, { stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    let forceKill: NodeJS.Timeout | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      // Killing the docker CLI alone would leave the container running; kill the container.
      spawn(docker, ["kill", containerName], { stdio: "ignore" }).on("error", () => {});
      forceKill = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (err) => {
      clearTimeout(timer);
      clearTimeout(forceKill);
      reject(new ExecutorError(`could not start ${docker}: ${err.message}`));
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(forceKill);
      let stderrText = stderr.toString();
      const exitCode = code ?? (signal ? 128 : 1);

      // Exit 125 with a docker-authored message means `docker run` itself failed (daemon,
      // image, mount), not the command. That's an infrastructure error, not an ExecResult.
      if (!timedOut && exitCode === 125 && /^docker: /m.test(stderrText)) {
        reject(new ExecutorError(`sandbox failed to start: ${stderrText.trim()}`));
        return;
      }

      if (stdout.truncated) stderrText += `\n[repro-executor] stdout truncated at ${maxOutputBytes} bytes`;
      if (stderr.truncated) stderrText += `\n[repro-executor] stderr truncated at ${maxOutputBytes} bytes`;
      resolve({
        exitCode,
        stdout: stdout.toString(),
        stderr: stderrText,
        timedOut,
        durationMs: Math.round(performance.now() - started),
      });
    });
  });
}

export class DockerExecutor implements Executor {
  constructor(readonly options: DockerExecutorOptions = {}) {}

  async exec(input: ExecRequest): Promise<ExecResult> {
    const request = ExecRequest.parse(input);
    const workspacePath = resolveWorkspacePath(request.workspacePath);
    const containerName = `repro-exec-${randomUUID()}`;
    const docker = this.options.dockerBin ?? "docker";
    const env = existsSync(join(workspacePath, VENV_DIR, "bin"))
      ? { PATH: `${CONTAINER_WORKSPACE}/${VENV_DIR}/bin:${SANDBOX_PATH}`, VIRTUAL_ENV: `${CONTAINER_WORKSPACE}/${VENV_DIR}` }
      : undefined;
    const args = buildDockerArgs({ ...request, workspacePath }, containerName, this.options, { env });
    return runContainer(docker, args, containerName, request.timeoutMs, this.options.maxOutputBytes ?? 32 * 1024 * 1024);
  }
}

// True when a Docker daemon is reachable and the given image exists locally. Used to skip
// sandbox-dependent integration tests on machines without Docker, never to fall back to the host.
export async function sandboxAvailable(image = DEFAULT_SANDBOX_IMAGE, dockerBin = "docker"): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(dockerBin, ["image", "inspect", image], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
