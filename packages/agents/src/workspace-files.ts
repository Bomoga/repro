/**
 * Path-checked, secret-redacting access to a Workspace's files for anything a model reads or
 * edits. Section 9: a leaked secret never reaches a model. gitleaks already redacts a
 * Finding's evidence, but the file around it still holds the real value, so every view of
 * workspace text handed to Gemini (file contents, diffs, command output) goes through
 * `redact`, and every edit Gemini makes goes through `restore` before it touches disk.
 * Secrets come from two places: the run's secret Findings, and Lane 2's secret patterns
 * (`redactSecrets`) applied to every text on its way to a model, which catches what a detector
 * missed.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { redactSecrets } from "@repro/detect";
import type { Finding, Workspace } from "./contracts.js";

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

export function isSecretFinding(finding: Finding): boolean {
  return finding.detectorId === "gitleaks" || /secret/i.test(finding.category);
}

const MIN_SECRET_LENGTH = 8;

/**
 * Two-way map between secret text and stable placeholder tokens. `redact` swaps every known
 * secret for its token; `restore` swaps tokens back, so an edit the model makes around a
 * redacted value keeps the real value on disk, and an edit that deletes the token removes it.
 */
export class SecretRedactor {
  private readonly pairs: { secret: string; token: string }[] = [];

  /** Registers a secret and returns its token; the same secret always gets the same token. */
  add(secret: string, kind: "SECRET" | "LINE" = "SECRET"): string | undefined {
    if (secret.length < MIN_SECRET_LENGTH) return undefined;
    const existing = this.pairs.find((pair) => pair.secret === secret);
    if (existing) return existing.token;
    const token = `[REDACTED-${kind}-${this.pairs.length + 1}]`;
    this.pairs.push({ secret, token });
    // Longest first, so a secret that contains another is replaced whole.
    this.pairs.sort((a, b) => b.secret.length - a.secret.length);
    return token;
  }

  get size(): number {
    return this.pairs.length;
  }

  redact(text: string): string {
    let out = text;
    for (const { secret, token } of this.pairs) out = out.split(secret).join(token);
    return out;
  }

  restore(text: string): string {
    let out = text;
    for (const { secret, token } of this.pairs) out = out.split(token).join(secret);
    return out;
  }
}

/**
 * Pulls the exact secret out of a line using gitleaks' redacted match as a template: the
 * evidence `KEY: 'REDACTED'` against the line `KEY: 'sk-abc…'` yields `sk-abc…`.
 */
export function extractSecrets(line: string, evidence: string): string[] | undefined {
  const template = evidence
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.includes("REDACTED"));
  if (!template) return undefined;
  const pattern = template.split("REDACTED").map(escapeRegExp).join("([^\\s'\"`]+)");
  const match = new RegExp(pattern).exec(line);
  if (!match) return undefined;
  const secrets = match.slice(1).filter((s): s is string => typeof s === "string" && s.length >= MIN_SECRET_LENGTH);
  return secrets.length > 0 ? secrets : undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KEY_BLOCK_START = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const KEY_BLOCK_END = /-----END [A-Z ]*PRIVATE KEY-----/;

/**
 * Registers every secret Lane 2's pattern list recognizes in `text`: the exact value when the
 * redacted line can serve as a template, the whole line otherwise, and every line of a private
 * key block.
 */
export function learnPatternSecrets(text: string, redactor: SecretRedactor): void {
  let inKeyBlock = false;
  for (const line of text.split(/\r?\n/)) {
    if (KEY_BLOCK_START.test(line)) inKeyBlock = true;
    if (inKeyBlock) {
      redactor.add(line.trim(), "LINE");
      if (KEY_BLOCK_END.test(line)) inKeyBlock = false;
      continue;
    }
    const redacted = redactSecrets(line);
    if (redacted === line) continue;
    const secrets = extractSecrets(line, redacted);
    if (secrets) for (const secret of secrets) redactor.add(secret, "SECRET");
    else redactor.add(line.trim(), "LINE");
  }
}

export interface ReplaceResult {
  ok: boolean;
  message: string;
}

const MAX_VIEW_BYTES = 512 * 1024;

export class WorkspaceFiles {
  private readonly index: Set<string>;

  private constructor(
    readonly workspace: Workspace,
    private readonly rootReal: string,
    readonly redactor: SecretRedactor,
  ) {
    this.index = new Set(workspace.fileIndex.map((file) => file.replace(/\\/g, "/")));
  }

  /**
   * Opens a workspace and learns every secret the run's secret Findings point to, so that
   * `redact` covers them even in files the model never asks for. Pass every Finding in the
   * run, not only the batch at hand.
   */
  static async open(workspace: Workspace, runFindings: Finding[]): Promise<WorkspaceFiles> {
    const rootReal = await fs.realpath(workspace.path);
    const files = new WorkspaceFiles(workspace, rootReal, new SecretRedactor());
    for (const finding of runFindings.filter(isSecretFinding)) {
      await files.learnSecret(finding);
    }
    return files;
  }

  private async learnSecret(finding: Finding): Promise<void> {
    let lines: string[];
    try {
      lines = splitLines(await fs.readFile(await this.resolve(finding.file), "utf8"));
    } catch {
      return; // A Finding pointing at an unreadable file has nothing to redact here.
    }
    const start = Math.max(1, finding.lineStart);
    const end = Math.min(lines.length, Math.max(finding.lineEnd, finding.lineStart));
    for (let lineNo = start; lineNo <= end; lineNo++) {
      const line = lines[lineNo - 1] ?? "";
      const secrets = extractSecrets(line, finding.evidence);
      if (secrets) {
        for (const secret of secrets) this.redactor.add(secret, "SECRET");
      } else {
        // No exact value to be found: withhold the whole line instead.
        this.redactor.add(line.trim(), "LINE");
      }
    }
  }

  /** Normalizes a model- or Finding-supplied path to a workspace-relative POSIX path. */
  normalize(file: string): string {
    const slashed = file.trim().replace(/\\/g, "/");
    if (slashed === "" || slashed.startsWith("/") || /^[a-zA-Z]:/.test(slashed)) {
      throw new WorkspacePathError(`path must be relative to the workspace: ${file}`);
    }
    const normalized = path.posix.normalize(slashed).replace(/^\.\//, "");
    if (normalized === ".." || normalized.startsWith("../")) {
      throw new WorkspacePathError(`path escapes the workspace: ${file}`);
    }
    return normalized;
  }

  has(file: string): boolean {
    try {
      return this.index.has(this.normalize(file));
    } catch {
      return false;
    }
  }

  /** Absolute path for an indexed file, refusing anything (symlinks included) that resolves
   *  outside the workspace. */
  async resolve(file: string): Promise<string> {
    const relative = this.normalize(file);
    if (!this.index.has(relative)) {
      throw new WorkspacePathError(`not a tracked file in this workspace: ${relative}`);
    }
    const real = await fs.realpath(path.join(this.rootReal, relative));
    if (real !== this.rootReal && !real.startsWith(this.rootReal + path.sep)) {
      throw new WorkspacePathError(`path resolves outside the workspace: ${relative}`);
    }
    return real;
  }

  /** The file as the model may see it: LF line endings, secrets redacted. */
  async readView(file: string): Promise<string> {
    const absolute = await this.resolve(file);
    const stat = await fs.stat(absolute);
    if (stat.size > MAX_VIEW_BYTES) {
      return `[file omitted: ${stat.size} bytes exceeds the ${MAX_VIEW_BYTES}-byte limit]`;
    }
    const raw = await fs.readFile(absolute, "utf8");
    if (raw.includes("\u0000")) return "[binary file omitted]";
    learnPatternSecrets(raw, this.redactor);
    return this.redactor.redact(raw.replace(/\r\n/g, "\n"));
  }

  /**
   * Replaces exactly one occurrence of `oldText` with `newText`, both expressed in the
   * redacted view. Placeholder tokens left in place are restored to the real value on disk;
   * the file's original line endings are preserved.
   */
  async replaceInView(file: string, oldText: string, newText: string): Promise<ReplaceResult> {
    const absolute = await this.resolve(file);
    const raw = await fs.readFile(absolute, "utf8");
    const crlf = raw.includes("\r\n");
    learnPatternSecrets(raw, this.redactor);
    const view = this.redactor.redact(raw.replace(/\r\n/g, "\n"));
    const oldNormalized = oldText.replace(/\r\n/g, "\n");
    if (oldNormalized === "") return { ok: false, message: "old_text must not be empty" };
    const count = view.split(oldNormalized).length - 1;
    if (count === 0) {
      return { ok: false, message: `old_text was not found in ${this.normalize(file)}; re-read the file and copy it exactly` };
    }
    if (count > 1) {
      return { ok: false, message: `old_text matches ${count} places in ${this.normalize(file)}; include more surrounding lines so it is unique` };
    }
    const index = view.indexOf(oldNormalized);
    const nextView = view.slice(0, index) + newText.replace(/\r\n/g, "\n") + view.slice(index + oldNormalized.length);
    const restored = this.redactor.restore(nextView);
    await fs.writeFile(absolute, crlf ? restored.replace(/\n/g, "\r\n") : restored, "utf8");
    return { ok: true, message: `replaced 1 occurrence in ${this.normalize(file)}` };
  }

  /** Redacts secrets from arbitrary text bound for a model (diffs, command output), including
   *  any the text itself reveals to Lane 2's patterns. */
  redact(text: string): string {
    learnPatternSecrets(text, this.redactor);
    return this.redactor.redact(text);
  }
}

export function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}
