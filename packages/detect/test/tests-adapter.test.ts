import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const JEST_SUITE = join(FIXTURES, "jest-suite");
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

// The project's own tests, run for real in the sandbox. No network needed: the fixtures have no
// dependencies, or stand in for the installed ones.
const ready = await sandboxAvailable();

/** Ingests a copy of a fixture directory as a one-commit git repo, the way a real target arrives. */
async function ingestFixture(dir: string, prefix: string): Promise<{ source: string; workspace: Workspace }> {
  const source = mkdtempSync(join(tmpdir(), `repro-${prefix}-`));
  cpSync(dir, source, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: source });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "seed");
  return { source, workspace: await ingest(`${prefix}-${Date.now()}`, { kind: "local", ref: source }) };
}

describe.skipIf(!ready)("tests adapter (sandbox)", () => {
  const exec = new DockerExecutor();
  let source: string;
  let workspace: Workspace;

  beforeAll(async () => {
    ({ source, workspace } = await ingestFixture(FAILING, "failing"));
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

// Review of PR #22, bug 1: `"test": "jest"` ran with plain `sh -c`, which never puts node_modules/.bin
// on PATH, so an installed Jest was "not found" (exit 127) and that setup problem came back as a
// reproduced failing test. The runners here stand in for what the install step would put in
// node_modules/.bin; the fixture commits no node_modules, just like a real target.
describe.skipIf(!ready)("tests adapter: runners installed in node_modules/.bin (sandbox)", () => {
  const exec = new DockerExecutor();
  const suiteCheck = "repro-test check 'suite' 'package.json' '5' 'jest'";
  const made: { source: string; workspace: Workspace }[] = [];

  // Each case gets its own freshly ingested workspace, with node_modules/.bin laid out on the host
  // before any container looks at it: Docker Desktop/Colima file sharing can briefly serve a
  // container a stale view of files the host deletes or re-creates right after a container read them.
  async function workspaceWith(bins: Record<string, { script: string; executable: boolean }>): Promise<Workspace> {
    const ingested = await ingestFixture(JEST_SUITE, "jest");
    made.push(ingested);
    const bin = join(ingested.workspace.path, "node_modules", ".bin");
    for (const [name, { script, executable }] of Object.entries(bins)) {
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, name), script, { mode: executable ? 0o755 : 0o644 });
    }
    return ingested.workspace;
  }
  const standInJest = (exitCode: number, output: string) => ({
    jest: { script: `#!/bin/sh\necho '${output}'\nexit ${exitCode}\n`, executable: true },
  });
  const run = (workspace: Workspace, command: string) => exec.exec({ workspacePath: workspace.path, command, timeoutMs: 120_000 });

  afterAll(() => {
    for (const { source, workspace } of made) {
      removeWorkspace(workspace);
      rmSync(source, { recursive: true, force: true });
    }
  });

  it("runs the test script's jest from node_modules/.bin, so a passing suite is no finding", async () => {
    const workspace = await workspaceWith(standInJest(0, "PASS src/sum.test.js: Tests: 3 passed, 3 total"));
    const detected = await detect(workspace, exec, [testsAdapter], { install: null });
    expect(detected.failures).toEqual([]);
    expect(detected.findings).toEqual([]);

    // A suite Finding from an earlier run re-checks as fixed, not as still failing.
    const check = await run(workspace, suiteCheck);
    expect(check.exitCode).toBe(0);
    expect(check.stdout).toMatch(/^NOT REPRODUCED tests jest in package\.json/);
  }, 120_000);

  it("reports a runner that isn't installed as a detector failure and 'could not tell', never a failing test", async () => {
    const workspace = await workspaceWith({});
    const detected = await detect(workspace, exec, [testsAdapter], { install: null });
    expect(detected.findings).toEqual([]);
    expect(detected.failures).toHaveLength(1);
    expect(detected.failures[0]).toMatchObject({ detectorId: "tests" });
    expect(detected.failures[0]!.message).toMatch(/the test command `jest` couldn't be run \(exit 127\): sh: 1: jest: not found/);

    const check = await run(workspace, suiteCheck);
    expect(check.exitCode).toBe(2);
    expect(check.stdout).not.toContain("REPRODUCED");
    expect(check.stderr).toMatch(/couldn't be run \(exit 127\)/);
  }, 120_000);

  it("treats a runner that isn't executable the same way", async () => {
    // Named by path, a non-executable runner exits 126. (Found through PATH, sh reports it as 127.)
    const workspace = await workspaceWith({ "jest-not-executable": { script: "#!/bin/sh\nexit 0\n", executable: false } });
    const check = await run(workspace, "repro-test check 'suite' 'package.json' '5' './node_modules/.bin/jest-not-executable'");
    expect(check.exitCode).toBe(2);
    expect(check.stdout).not.toContain("REPRODUCED");
    expect(check.stderr).toMatch(/couldn't be run \(exit 126\)/);
  }, 120_000);

  it("still turns a runner that runs and fails into a reproduced suite Finding", async () => {
    const workspace = await workspaceWith(standInJest(1, "FAIL src/sum.test.js: expected 4, received 5"));
    const detected = await detect(workspace, exec, [testsAdapter], { install: null });
    expect(detected.failures).toEqual([]);
    expect(detected.findings.map((f) => [f.ruleId, f.file, f.lineStart, f.reproducible])).toEqual([["suite:jest", "package.json", 5, false]]);
    expect(detected.findings[0]!.reproductionCommand).toBe(suiteCheck);

    const { findings } = await reproduce(detected.findings, workspace, exec);
    expect(findings[0]!.reproducible).toBe(true);
    expect(findings[0]!.reproductionOutput).toMatch(/^REPRODUCED tests jest at package\.json:5-5: /);
  }, 120_000);
});
