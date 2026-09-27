import { rmSync } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTestFile, readFilesForPrompt, relatedTestFiles, renderPreloadedFiles } from "../src/file-context.js";
import { WorkspaceFiles } from "../src/workspace-files.js";
import { FIXTURE_FINDINGS, PLANTED_SECRET } from "./fixtures/findings.js";
import { materializeWorkspace, type FixtureWorkspace } from "./helpers/workspace.js";

describe("renderPreloadedFiles", () => {
  const file = (name: string, size: number) => ({ path: name, text: `${name}\n${"x".repeat(size)}` });

  it("keeps whole files while they fit, cuts the next one with a visible marker, and names the rest", () => {
    const cap = 8_000;
    const rendered = renderPreloadedFiles([file("src/a.js", 5_000), file("src/b.js", 5_000), file("src/c.js", 5_000)], cap);
    const [blocks, leftOut] = rendered.split("\n\nLeft out");

    expect(blocks!.length).toBeLessThanOrEqual(cap);
    expect(blocks).toContain("src/a.js (2 lines)\n```\nsrc/a.js\n");
    expect(blocks).toContain("src/b.js (2 lines, cut short)");
    expect(blocks).toMatch(/…\[truncated: \d+ more characters; read_file returns the whole file\]\n```$/);
    expect(blocks).not.toContain("src/c.js");
    expect(leftOut).toBe(" to keep this input short (read_file returns them): src/c.js");
  });

  it("says why a file couldn't be read instead of dropping it silently", () => {
    expect(renderPreloadedFiles([{ path: "src/gone.js", note: "not in the tree (the patch deletes it)" }], 1_000)).toBe(
      "src/gone.js: not in the tree (the patch deletes it)",
    );
  });
});

describe("reading files for a prompt", () => {
  let fixture: FixtureWorkspace;
  beforeEach(() => {
    fixture = materializeWorkspace();
  });
  afterEach(() => fixture.cleanup());

  it("reads files exactly as read_file does, secrets redacted, and notes the ones it can't", async () => {
    const files = await WorkspaceFiles.open(fixture.workspace, FIXTURE_FINDINGS);
    rmSync(path.join(fixture.workspace.path, "src/assistant.js"));
    const preloaded = await readFilesForPrompt(files, ["src/config.js", "src/config.js", "src/assistant.js", "../outside.js"]);

    expect(preloaded.map((p) => p.path)).toEqual(["src/config.js", "src/assistant.js", "../outside.js"]);
    expect(preloaded[0]!.text).toContain("OPENAI_API_KEY: '[REDACTED-SECRET-1]'");
    expect(JSON.stringify(preloaded)).not.toContain(PLANTED_SECRET);
    expect(preloaded[1]).toMatchObject({ note: "not in the tree (the patch deletes it)" });
    expect(preloaded[2]).toMatchObject({ note: expect.stringContaining("escapes the workspace") });
  });

  it("finds the tracked tests that mention a changed module", async () => {
    const files = await WorkspaceFiles.open(fixture.workspace, []);
    expect(await relatedTestFiles(files, ["src/db.js"])).toEqual(["test/db.test.js"]);
    expect(await relatedTestFiles(files, ["src/config.js"])).toEqual([]);
  });

  it("recognises test files by name and directory, in code only", () => {
    expect(["tests/test_share.py", "api/share_test.py", "test/db.test.js", "src/__tests__/x.ts", "conftest.py", "spec/a.spec.tsx"].every(isTestFile)).toBe(true);
    expect(["src/db.js", "api/testing.py", "test/fixtures/data.json", "README.md"].some(isTestFile)).toBe(false);
  });
});
