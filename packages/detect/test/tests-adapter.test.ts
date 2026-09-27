import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Finding, type Workspace } from "@repro/contracts";
import { DockerExecutor, sandboxAvailable } from "@repro/executor";
import { ingest, removeWorkspace } from "@repro/ingest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFailingTests, testsAdapter } from "../src/adapters/tests.ts";
import { detect } from "../src/engine.ts";
import { reproduce } from "../src/reproduce.ts";
import { DetectorError } from "../src/util.ts";
import { FIXTURES, FakeExecutor, fixture } from "./helpers.ts";

const FAILING = join(FIXTURES, "failing-tests");
const fixtureWorkspace: Workspace = {
  runId: "run-test",
  path: FAILING,
  fileIndex: ["package.json", "lib/cart.js", "test/cart.test.js", "shop/pricing.py", "shop/tests/test_pricing.py"],
  languages: ["javascript", "python"],
  headCommit: "0".repeat(40),
};

describe("tests adapter", () => {
  it("turns each failing test into a correctness Finding that re-runs just that test", () => {
    const findings = parseFailingTests(fixture("failing-tests.json"), fixtureWorkspace);
    expect(findings.map((f) => [f.ruleId, f.file, f.lineStart, f.category])).toEqual([
      ["node:totals every line item", "test/cart.test.js", 16, "correctness"],
      ["unittest:shop.tests.test_pricing.PricingTest.test_discount", "shop/tests/test_pricing.py", 11, "correctness"],
    ]);
    const [node, py] = findings;
    for (const f of findings) {
      Finding.parse(f);
      expect(f).toMatchObject({ detectorId: "tests", reproducible: false });
    }
    expect(node!.reproductionCommand).toBe("repro-test check 'node' 'test/cart.test.js' '16' 'totals every line item'");
    expect(py!.reproductionCommand).toBe("repro-test check 'unittest' 'shop/tests/test_pricing.py' '11' 'shop.tests.test_pricing.PricingTest.test_discount' '.'");
    expect(node!.message).toBe('Test "totals every line item" fails: Expected values to be strictly equal: 6 !== 11');
    expect(node!.evidence).toBe("test('totals every line item', () => {");
  });

  it("treats a suite it couldn't run as a failure, not as all tests passing", async () => {
    const exec = new FakeExecutor(() => ({ exitCode: 2, stderr: "repro-test: timed out" }));
    await expect(testsAdapter.run(fixtureWorkspace, exec)).rejects.toBeInstanceOf(DetectorError);
  });
});

// The project's own tests, run for real in the sandbox. No network needed: the fixture has no dependencies.
const ready = await sandboxAvailable();

describe.skipIf(!ready)("tests adapter (sandbox)", () => {
  const exec = new DockerExecutor();
  let source: string;
  let workspace: Workspace;

  beforeAll(async () => {
    source = mkdtempSync(join(tmpdir(), "repro-failing-"));
    cpSync(FAILING, source, { recursive: true });
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: source });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "seed");
    workspace = await ingest(`tests-${Date.now()}`, { kind: "local", ref: source });
  }, 60_000);

  afterAll(() => {
    if (workspace) removeWorkspace(workspace);
    rmSync(source, { recursive: true, force: true });
  });

  it("finds the failing tests, confirms each by re-running it alone, and sees the fix", async () => {
    const detected = await detect(workspace, exec, [testsAdapter], { install: null });
    expect(detected.failures).toEqual([]);
    expect(detected.findings.map((f) => f.ruleId).sort()).toEqual([
      "node:totals every line item",
      "unittest:shop.tests.test_pricing.PricingTest.test_discount",
    ]);

    const { findings } = await reproduce(detected.findings, workspace, exec);
    for (const f of findings) {
      expect(f.reproducible).toBe(true);
      expect(f.reproductionOutput).toMatch(new RegExp(`^REPRODUCED tests .* at ${f.file}:${f.lineStart}-`));
    }

    // Fix the bug in the code (not the test): the same reproductionCommand now reports it fixed.
    const cart = join(workspace.path, "lib/cart.js");
    const original = readFileSync(cart, "utf8");
    writeFileSync(cart, original.replace("items.length - 1", "items.length"));
    try {
      const node = findings.find((f) => f.ruleId.startsWith("node:"))!;
      const after = await exec.exec({ workspacePath: workspace.path, command: node.reproductionCommand!, timeoutMs: 120_000 });
      expect(after.exitCode).toBe(0);
      expect(after.stdout).toContain("NOT REPRODUCED");
    } finally {
      writeFileSync(cart, original);
    }
  }, 300_000);
});
