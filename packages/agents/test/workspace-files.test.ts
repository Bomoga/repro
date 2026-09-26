import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecretRedactor, WorkspaceFiles, WorkspacePathError, extractSecrets, learnPatternSecrets } from "../src/workspace-files.js";
import { FIXTURE_FINDINGS, HARDCODED_KEY, PLANTED_SECRET } from "./fixtures/findings.js";
import { materializeWorkspace, type FixtureWorkspace } from "./helpers/workspace.js";

describe("extractSecrets", () => {
  it("uses gitleaks' redacted match as a template to find the exact secret", () => {
    const line = `  OPENAI_API_KEY: '${PLANTED_SECRET}',`;
    expect(extractSecrets(line, "OPENAI_API_KEY: 'REDACTED'")).toEqual([PLANTED_SECRET]);
  });

  it("handles Python assignments and gitleaks' generic key = value matches", () => {
    const secret = "9f2c4e7a1b3d5f6e8a0c2e4f6a8b0d1c";
    expect(extractSecrets(`OPENAI_API_KEY = "sk-live-${secret}"`, 'OPENAI_API_KEY = "REDACTED"')).toEqual([`sk-live-${secret}`]);
    expect(extractSecrets(`    token=${secret}  # rotate me`, "token=REDACTED")).toEqual([secret]);
  });

  it("returns undefined when the evidence has no redaction marker or doesn't match", () => {
    expect(extractSecrets("token = abcdefghijkl", "token = abcdefghijkl")).toBeUndefined();
    expect(extractSecrets("something else entirely", "api_key = 'REDACTED'")).toBeUndefined();
  });
});

describe("SecretRedactor", () => {
  it("round-trips secrets through stable tokens", () => {
    const redactor = new SecretRedactor();
    const token = redactor.add(PLANTED_SECRET)!;
    expect(token).toBe("[REDACTED-SECRET-1]");
    expect(redactor.add(PLANTED_SECRET)).toBe(token);
    const text = `key=${PLANTED_SECRET}; again ${PLANTED_SECRET}`;
    const redacted = redactor.redact(text);
    expect(redacted).not.toContain(PLANTED_SECRET);
    expect(redactor.restore(redacted)).toBe(text);
  });

  it("ignores values too short to be a secret", () => {
    const redactor = new SecretRedactor();
    expect(redactor.add("abc")).toBeUndefined();
    expect(redactor.size).toBe(0);
  });
});

describe("WorkspaceFiles", () => {
  let fixture: FixtureWorkspace;
  let files: WorkspaceFiles;

  beforeEach(async () => {
    fixture = materializeWorkspace();
    files = await WorkspaceFiles.open(fixture.workspace, FIXTURE_FINDINGS);
  });
  afterEach(() => fixture.cleanup());

  const onDisk = (file: string) => readFileSync(path.join(fixture.workspace.path, file), "utf8");

  it("never shows the model a secret the run's gitleaks findings point to", async () => {
    const view = await files.readView("src/config.js");
    expect(view).not.toContain(PLANTED_SECRET);
    expect(view).toContain("OPENAI_API_KEY: '[REDACTED-SECRET-1]'");
    // The same value is scrubbed from any other text bound for a model, e.g. a diff.
    expect(files.redact(`-  OPENAI_API_KEY: '${PLANTED_SECRET}',`)).toBe("-  OPENAI_API_KEY: '[REDACTED-SECRET-1]',");
  });

  it("keeps the real value on disk when an edit leaves the placeholder in place", async () => {
    const result = await files.replaceInView("src/config.js", "model: 'demo-chat-1'", "model: 'demo-chat-2'");
    expect(result.ok).toBe(true);
    expect(onDisk("src/config.js")).toContain(`OPENAI_API_KEY: '${PLANTED_SECRET}'`);
    expect(onDisk("src/config.js")).toContain("model: 'demo-chat-2'");
  });

  it("removes the secret from disk when the edit replaces the placeholder", async () => {
    const result = await files.replaceInView(
      "src/config.js",
      "OPENAI_API_KEY: '[REDACTED-SECRET-1]',",
      "OPENAI_API_KEY: process.env.OPENAI_API_KEY,",
    );
    expect(result.ok).toBe(true);
    expect(onDisk("src/config.js")).not.toContain(PLANTED_SECRET);
    expect(onDisk("src/config.js")).toContain("OPENAI_API_KEY: process.env.OPENAI_API_KEY,");
  });

  it("redacts a secret no detector flagged, using Lane 2's secret patterns", async () => {
    // The real sandbox run: gitleaks missed this key, so no Finding pointed at it.
    const unflagged = await WorkspaceFiles.open(fixture.workspace, []);
    const view = await unflagged.readView("src/config.js");
    expect(view).not.toContain(PLANTED_SECRET);
    expect(view).toMatch(/OPENAI_API_KEY: '\[REDACTED-SECRET-\d+\]'/);
    expect(unflagged.redact(`-  OPENAI_API_KEY: '${PLANTED_SECRET}',`)).not.toContain(PLANTED_SECRET);

    const edit = await unflagged.replaceInView("src/config.js", "model: 'demo-chat-1'", "model: 'demo-chat-2'");
    expect(edit.ok).toBe(true);
    expect(onDisk("src/config.js")).toContain(`OPENAI_API_KEY: '${PLANTED_SECRET}'`);
  });

  it("withholds every line of a private key block", async () => {
    const redactor = new SecretRedactor();
    const block = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gunVTLw", "-----END RSA PRIVATE KEY-----"];
    learnPatternSecrets(["const key = `", ...block, "`;"].join("\n"), redactor);
    expect(redactor.redact(block.join("\n"))).not.toContain("MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gunVTLw");
  });

  it("withholds the whole line when the evidence can't locate the secret", async () => {
    const opaque = { ...HARDCODED_KEY, evidence: "(redacted by detector)" };
    const lineFiles = await WorkspaceFiles.open(fixture.workspace, [opaque]);
    const view = await lineFiles.readView("src/config.js");
    expect(view).not.toContain(PLANTED_SECRET);
    expect(view).toContain("[REDACTED-LINE-1]");
  });

  it("requires old_text to match exactly once", async () => {
    expect((await files.replaceInView("src/db.js", "not in the file", "x")).ok).toBe(false);
    const ambiguous = await files.replaceInView("src/db.js", "db.query(", "db.run(");
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.message).toMatch(/matches 3 places/);
    expect(onDisk("src/db.js")).toContain("db.query(");
  });

  it("preserves CRLF line endings on files that use them", async () => {
    const file = path.join(fixture.workspace.path, "src/db.js");
    writeFileSync(file, onDisk("src/db.js").replace(/\n/g, "\r\n"));
    const result = await files.replaceInView("src/db.js", "function deleteNote(db, ownerId, noteId) {\n", "function deleteNote(db, ownerId, noteId) { // edited\n");
    expect(result.ok).toBe(true);
    const updated = onDisk("src/db.js");
    expect(updated).toContain("// edited\r\n");
    expect(updated.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("refuses paths outside the workspace or outside the file index", async () => {
    await expect(files.readView("../outside.js")).rejects.toThrow(WorkspacePathError);
    await expect(files.readView("/etc/passwd")).rejects.toThrow(WorkspacePathError);
    await expect(files.readView("C:\\Windows\\win.ini")).rejects.toThrow(WorkspacePathError);
    await expect(files.readView("src/untracked.js")).rejects.toThrow(WorkspacePathError);
    await expect(files.replaceInView("src/../../x.js", "a", "b")).rejects.toThrow(WorkspacePathError);
    expect(files.normalize("./src\\db.js")).toBe("src/db.js");
  });
});
