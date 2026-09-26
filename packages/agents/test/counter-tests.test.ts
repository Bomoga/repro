import { describe, expect, it } from "vitest";
import type { ExecResult } from "../src/contracts.js";
import { missingModule, outcomeOfRun } from "../src/verify/counter-tests.js";
import { renderRun } from "../src/verify/prompt.js";

const result = (exitCode: number, stderr = ""): ExecResult => ({ exitCode, stdout: "", stderr, timedOut: false, durationMs: 5 });
const noExpress = result(1, "Error: Cannot find module 'express'\nRequire stack:\n- /workspace/src/server.js");

describe("counter-test outcomes", () => {
  it("names the module a Node or Python run couldn't load", () => {
    expect(missingModule(noExpress)).toBe("express");
    expect(missingModule(result(1, "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express' imported from /workspace/src/server.mjs"))).toBe("express");
    expect(missingModule(result(1, "ModuleNotFoundError: No module named 'flask'"))).toBe("flask");
    expect(missingModule(result(1, "AssertionError: expected 1 to equal 2"))).toBeUndefined();
  });

  it("calls a test that can't load the same module on either tree inconclusive, and keeps every real signal", () => {
    expect(outcomeOfRun(noExpress, noExpress)).toBe("inconclusive");
    // The patch introduced the missing dependency: a real regression.
    expect(outcomeOfRun(result(0), noExpress)).toBe("regression");
    // The patched tree no longer needs the package, and the test passes there.
    expect(outcomeOfRun(noExpress, result(0))).toBe("fix-holds");
    // A real assertion failing on both trees still means the hole is open.
    const assertion = result(1, "AssertionError: the preview's markup was not escaped");
    expect(outcomeOfRun(assertion, assertion)).toBe("hole-open");
    expect(outcomeOfRun(noExpress, result(1, "Error: Cannot find module './preview'"))).toBe("hole-open");
  });

  it("tells the Challenger which package is missing and how to test around it", () => {
    const test = { path: "test/xss.test.js", code: "", command: "node test/xss.test.js", description: "the formula preview escapes HTML" };
    const text = renderRun(
      { test, before: { status: "fail", result: noExpress }, after: { status: "fail", result: noExpress }, outcome: "inconclusive" },
      (t) => t,
    );
    expect(text).toContain("test/xss.test.js: the command couldn't run, so this says nothing");
    expect(text).toContain("both runs failed to load 'express', which isn't installed here: the sandbox has no network.");
  });
});
