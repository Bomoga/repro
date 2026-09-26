import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACES_ROOT,
  DockerExecutor,
  ExecutorError,
  buildDockerArgs,
  sandboxAvailable,
} from "../src/index.ts";

describe("buildDockerArgs", () => {
  const args = buildDockerArgs({ workspacePath: "/w", command: "echo hi", timeoutMs: 1000 }, "c1", { image: "img" });

  it("runs ephemeral, with no network and no capabilities", () => {
    expect(args).toContain("--rm");
    expect(args.join(" ")).toContain("--network none");
    expect(args.join(" ")).toContain("--cap-drop ALL");
    expect(args).toContain("--read-only");
  });

  it("mounts only the workspace, and passes the command as one argv entry", () => {
    expect(args).toContain("type=bind,src=/w,dst=/workspace");
    expect(args.slice(-4)).toEqual(["img", "sh", "-c", "echo hi"]);
  });
});

// Integration: needs a Docker daemon. Uses plain alpine so it doesn't depend on the sandbox image.
const image = "alpine:3.20";
const hasDocker = await sandboxAvailable(image);

describe.skipIf(!hasDocker)("DockerExecutor (integration)", () => {
  const exec = new DockerExecutor({ image });
  let ws: string;

  beforeAll(() => {
    mkdirSync(DEFAULT_WORKSPACES_ROOT, { recursive: true });
    ws = mkdtempSync(join(DEFAULT_WORKSPACES_ROOT, "exec-test-"));
    writeFileSync(join(ws, "hello.txt"), "from the host\n");
  });
  afterAll(() => rmSync(ws, { recursive: true, force: true }));

  it("returns the command's exit code and output without interpreting it", async () => {
    const r = await exec.exec({ workspacePath: ws, command: "cat hello.txt; echo oops >&2; exit 3", timeoutMs: 20_000 });
    expect(r).toMatchObject({ exitCode: 3, stdout: "from the host\n", timedOut: false });
    expect(r.stderr).toContain("oops");
  });

  it("has no network", async () => {
    const r = await exec.exec({
      workspacePath: ws,
      command: "wget -T 3 -q -O- http://example.com >/dev/null 2>&1 && echo online || echo offline",
      timeoutMs: 20_000,
    });
    expect(r.stdout.trim()).toBe("offline");
  });

  it("can write to the workspace but not to the container root", async () => {
    const r = await exec.exec({ workspacePath: ws, command: "echo x > out.txt; touch /etc/nope", timeoutMs: 20_000 });
    expect(r.exitCode).not.toBe(0);
    expect(readFileSync(join(ws, "out.txt"), "utf8")).toBe("x\n");
  });

  it("kills the container on timeout", async () => {
    const r = await exec.exec({ workspacePath: ws, command: "sleep 30", timeoutMs: 1_000 });
    expect(r.timedOut).toBe(true);
    expect(r.durationMs).toBeLessThan(15_000);
  });

  it("throws ExecutorError when the sandbox itself can't start", async () => {
    await expect(
      new DockerExecutor({ image: "repro-no-such-image:missing" }).exec({ workspacePath: ws, command: "true", timeoutMs: 20_000 }),
    ).rejects.toBeInstanceOf(ExecutorError);
    await expect(exec.exec({ workspacePath: "relative/path", command: "true", timeoutMs: 1000 })).rejects.toBeInstanceOf(
      ExecutorError,
    );
  });
});
