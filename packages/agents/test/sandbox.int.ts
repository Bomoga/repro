import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { detect, reproduce } from "@repro/detect";
import { DockerExecutor, sandboxAvailable } from "@repro/executor";
import { ingest, removeWorkspace } from "@repro/ingest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PatchSchema, type Finding, type Workspace } from "../src/contracts.js";
import { diagnose, isRepairEligible } from "../src/diagnose/diagnose.js";
import { MemoryInteractionLog, createGeminiClient } from "../src/gemini.js";
import { repairAndVerify, type RepairAndVerifyResult } from "../src/pipeline.js";
import { PLANTED_SECRET } from "./fixtures/findings.js";
import { DEMO_TARGET } from "./helpers/workspace.js";

// Lane 3 on the real stack: Lane 2's ingest, detectors, and reproduction step, the Docker
// sandbox for every command (tests, reproduction re-runs, git, counter-tests), and the real
// Gemini API. Skipped unless the sandbox image is built (`npm run sandbox:build`).
const ready = Boolean(process.env.GEMINI_API_KEY) && (await sandboxAvailable());

describe.skipIf(!ready)("lane 3 on the real sandbox and the real Gemini API", () => {
  const exec = new DockerExecutor();
  const log = new MemoryInteractionLog();
  let source: string;
  let workspace: Workspace;
  let findings: Finding[];
  const results: (RepairAndVerifyResult & { findingIds: string[] })[] = [];

  beforeAll(async () => {
    source = mkdtempSync(path.join(tmpdir(), "repro-demo-target-"));
    cpSync(DEMO_TARGET, source, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=fixture@repro.invalid", "-c", "user.name=fixture", "-c", "core.autocrlf=false", ...args], { cwd: source });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "demo target");
    workspace = await ingest(`lane3-${Date.now()}`, { kind: "local", ref: source });

    const detected = await detect(workspace, exec);
    expect(detected.failures).toEqual([]);
    findings = (await reproduce(detected.findings, workspace, exec)).findings;
    console.log(`findings: ${findings.map((f) => `${f.detectorId}/${f.ruleId}@${f.file}:${f.lineStart} ${f.reproducible ? "CONFIRMED" : "unconfirmed"}`).join("\n  ")}`);
  }, 900_000);

  afterAll(() => {
    if (workspace) removeWorkspace(workspace);
    if (source) rmSync(source, { recursive: true, force: true });
  });

  it("diagnoses the real Findings, then repairs and verifies every confirmed one in the sandbox", async () => {
    const gemini = createGeminiClient({ log });
    const diagnosed = await diagnose({ findings, workspace }, { gemini });
    const eligible = diagnosed.diagnoses.filter((d) => isRepairEligible(d, findings));
    expect(eligible.length).toBeGreaterThan(0);

    for (const diagnosis of eligible) {
      const result = await repairAndVerify({ diagnosis, findings, workspace }, { gemini, executor: exec, detectors: [] });
      results.push({ ...result, findingIds: diagnosis.findingIds });
      console.log(
        `\n=== [${diagnosis.findingIds.join(", ")}] -> ${result.patch.status} after ${result.attempts.length} attempt(s)\n` +
          `${result.patch.challengerNotes}\n${result.patch.diff}`,
      );
      expect(PatchSchema.parse(result.patch)).toEqual(result.patch);
    }
    expect(results.some((r) => r.patch.status === "verified")).toBe(true);
    for (const entry of log.entries) expect(JSON.stringify(entry.request)).not.toContain(PLANTED_SECRET);
  }, 3_600_000);

  it("shows the fix holds on a fresh checkout: the reproduction command no longer fires", async () => {
    for (const { patch, findingIds } of results.filter((r) => r.patch.status === "verified")) {
      const clean = await ingest(`lane3-after-${Date.now()}`, { kind: "local", ref: source });
      try {
        writeFileSync(path.join(clean.path, "verified.diff"), patch.diff);
        const applied = await exec.exec({ workspacePath: clean.path, command: "git apply verified.diff && rm verified.diff", timeoutMs: 60_000 });
        expect(applied.exitCode).toBe(0);
        for (const finding of findings.filter((f) => findingIds.includes(f.id))) {
          const after = await exec.exec({ workspacePath: clean.path, command: finding.reproductionCommand!, timeoutMs: 120_000 });
          expect(after.exitCode, after.stdout + after.stderr).toBe(0);
          expect(after.stdout).toContain("NOT REPRODUCED");
        }
      } finally {
        removeWorkspace(clean);
      }
    }
  }, 900_000);
});
