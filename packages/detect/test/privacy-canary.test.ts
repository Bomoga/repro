import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@repro/contracts";
import { DockerExecutor, sandboxAvailable } from "@repro/executor";
import { ingest, removeWorkspace } from "@repro/ingest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canaryCommand, enclosingFunction, privacyCheckOf, privacyPatternsAdapter } from "../src/adapters/privacy-patterns.ts";
import { parseSemgrepReport } from "../src/adapters/semgrep.ts";
import { detect } from "../src/engine.ts";
import { reproduce } from "../src/reproduce.ts";
import { FIXTURES, fixture, seededWorkspace } from "./helpers.ts";

describe("canary eligibility", () => {
  it("reads the privacy check out of the rule id", () => {
    expect(privacyCheckOf("privacy.prompt-logging.js")).toBe("prompt-logging");
    expect(privacyCheckOf("privacy.oauth-broad-scope.google.py")).toBe("oauth-broad-scope");
    expect(privacyCheckOf("python.lang.x")).toBeUndefined();
  });

  it("finds the top-level function a line sits in, and refuses anything it can't call", () => {
    const py = "import json\n\n\n@cache\ndef remember(messages, path):\n    log(messages)\n    with open(path) as fh:\n        fh.write(1)\n\nclass Store:\n    def put(self, x):\n        log(x)\n\nlog(1)\n";
    expect(enclosingFunction(py, 8, "python")).toBe("remember");
    expect(enclosingFunction(py, 12, "python")).toBeUndefined(); // a method
    expect(enclosingFunction(py, 14, "python")).toBeUndefined(); // module-level code
    const js = "const x = 1;\n\nasync function trackQuestion(q) {\n  await fetch(u, { body: q });\n}\n\nconst save = (id, m) => {\n  fs.writeFileSync(p, m);\n};\n\nclass A {\n  m(q) {\n    console.log(q);\n  }\n}\n";
    expect(enclosingFunction(js, 4, "javascript")).toBe("trackQuestion");
    expect(enclosingFunction(js, 8, "javascript")).toBe("save");
    expect(enclosingFunction(js, 13, "javascript")).toBeUndefined();
  });

  it("gives canary commands to callable Python/JS findings and leaves the rest on Semgrep", () => {
    const findings = parseSemgrepReport(fixture("semgrep-privacy.json"), seededWorkspace, "privacy-patterns", "privacy-patterns");
    const commands = Object.fromEntries(findings.map((f) => [`${f.file}:${f.lineStart}`, canaryCommand(seededWorkspace, f)]));
    expect(commands["assistant/memory.py:8"]).toBe(
      "repro-canary 'prompt-logging' 'assistant/memory.py' 'remember' '8' 'privacy-patterns' 'privacy.prompt-logging.py'",
    );
    expect(commands["assistant/memory.py:10"]).toMatch(/^repro-canary 'unencrypted-conversation-storage' /);
    expect(commands["assistant/chat.ts:4"]).toBeUndefined(); // TypeScript: the harness doesn't run it
    expect(commands["assistant/chat.ts:17"]).toBeUndefined(); // an OAuth scope: nothing to trace
  });
});

// Canary tracing for real, in the sandbox. No network: the canary never leaves (and couldn't).
const ready = await sandboxAvailable();

describe.skipIf(!ready)("canary tracing (sandbox)", () => {
  const exec = new DockerExecutor();
  const sources: string[] = [];
  const workspaces: Workspace[] = [];
  const repo = async (dir: string) => {
    const source = mkdtempSync(join(tmpdir(), "repro-canary-"));
    sources.push(source);
    cpSync(dir, source, { recursive: true });
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: source });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "seed");
    const ws = await ingest(`canary-${Date.now()}-${workspaces.length}`, { kind: "local", ref: source });
    workspaces.push(ws);
    return ws;
  };
  afterAll(() => {
    workspaces.forEach(removeWorkspace);
    sources.forEach((s) => rmSync(s, { recursive: true, force: true }));
  });

  it("watches JavaScript send, store, and log the canary, and sees each fix", async () => {
    const ws = await repo(join(FIXTURES, "canary-js"));
    const detected = await detect(ws, exec, [privacyPatternsAdapter], { install: null });
    const { findings } = await reproduce(detected.findings, ws, exec);
    const out = Object.fromEntries(findings.map((f) => [f.ruleId, f.reproductionOutput ?? ""]));
    expect(out["privacy.third-party-forwarding.js"]).toMatch(/^REPRODUCED canary third-party-forwarding at telemetry\.js:\d+-\d+: canary sent to events\.insights-vendor\.example/);
    expect(out["privacy.unencrypted-conversation-storage.js"]).toMatch(/canary written in plaintext to data\/history\/repro-canary-user\.json/);
    expect(out["privacy.prompt-logging.js"]).toMatch(/canary reached the logs: "\[assistant\] prompt: <canary>"/);
    expect(existsSync(join(ws.path, "data"))).toBe(false); // the run cleans up after itself

    const telemetry = findings.find((f) => f.ruleId === "privacy.third-party-forwarding.js")!;
    const file = join(ws.path, "telemetry.js");
    writeFileSync(file, readFileSync(file, "utf8").replace("userId, prompt: question", "userId"));
    const after = await exec.exec({ workspacePath: ws.path, command: telemetry.reproductionCommand!, timeoutMs: 120_000 });
    expect(after.exitCode).toBe(0);
    expect(after.stdout).toMatch(/^NOT REPRODUCED canary third-party-forwarding/);
  }, 300_000);

  it("watches Python log and store the canary, and sees the logging fix", async () => {
    const ws = await repo(join(FIXTURES, "seeded-target"));
    const detected = await detect(ws, exec, [privacyPatternsAdapter], { install: null });
    const { findings } = await reproduce(detected.findings, ws, exec);
    const logging = findings.find((f) => f.ruleId === "privacy.prompt-logging.py")!;
    const storage = findings.find((f) => f.ruleId === "privacy.unencrypted-conversation-storage.py")!;
    expect(logging.reproductionOutput).toMatch(/^REPRODUCED canary prompt-logging at assistant\/memory\.py:8-8: canary reached the logs/);
    expect(storage.reproductionOutput).toMatch(/^REPRODUCED canary unencrypted-conversation-storage at assistant\/memory\.py:10-10: canary written in plaintext/);
    // TypeScript findings keep the static reproduction.
    expect(findings.find((f) => f.ruleId === "privacy.prompt-logging.js")!.reproductionOutput).toMatch(/^REPRODUCED semgrep /);

    const file = join(ws.path, "assistant/memory.py");
    writeFileSync(file, readFileSync(file, "utf8").replace('logger.info("storing conversation: %s", messages)', 'logger.info("storing %d messages", len(messages))'));
    const after = await exec.exec({ workspacePath: ws.path, command: logging.reproductionCommand!, timeoutMs: 120_000 });
    expect(after.stdout).toMatch(/^NOT REPRODUCED canary prompt-logging/);
  }, 300_000);
});
