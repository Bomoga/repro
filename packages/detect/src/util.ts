import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

// Single-quote a string for `sh -c`. Every path and rule id that goes into a command string is
// target-controlled or tool-reported text, so none of it is ever interpolated unquoted.
export function shq(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// Deterministic within a run: the same rule matching the same span in the same run always gets
// the same id, and duplicates reported twice by a tool collapse into one Finding.
export function findingId(parts: {
  runId: string;
  detectorId: string;
  ruleId: string;
  file: string;
  span: string;
}): string {
  const h = createHash("sha256");
  h.update([parts.runId, parts.detectorId, parts.ruleId, parts.file, parts.span].join("\0"));
  return `fnd_${h.digest("hex").slice(0, 20)}`;
}

const REDACTED = "REDACTED";

// Defense in depth on top of gitleaks --redact (CLAUDE.md section 9): anything that leaves lane 2
// as evidence or reproduction output passes through here, so a secret-shaped value that some other
// rule happened to match still never reaches the Run Store, a log, or a model.
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
  [/\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g, REDACTED],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, REDACTED],
  // key = "value" / key: 'value' where the key name says it's a credential.
  [
    /((?:api[_-]?key|secret|token|passw(?:or)?d|pwd|credential|private[_-]?key|access[_-]?key)[A-Za-z0-9_-]*["']?\s*[:=]\s*["'`])([^"'`\s]{8,})(["'`])/gi,
    `$1${REDACTED}$3`,
  ],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated ${text.length - max} chars]`;
}

const EVIDENCE_MAX_LINES = 20;
const EVIDENCE_MAX_CHARS = 2000;
const EVIDENCE_MAX_FILE_BYTES = 5 * 1024 * 1024;

// The exact lines a Finding points at, read from the workspace on the host (a read, not an
// execution). Refuses anything that resolves outside the workspace, and redacts secrets.
export function readEvidence(workspacePath: string, file: string, lineStart: number, lineEnd: number): string {
  const root = realpathSync(workspacePath);
  let full: string;
  try {
    full = realpathSync(join(root, file));
  } catch {
    return "";
  }
  if (!full.startsWith(root + sep)) return "";
  const fd = openSync(full, "r");
  try {
    const size = Math.min(fstatSync(fd).size, EVIDENCE_MAX_FILE_BYTES);
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, 0);
    const lines = buf.toString("utf8").split(/\r?\n/);
    const last = Math.min(lineEnd, lineStart + EVIDENCE_MAX_LINES - 1);
    const snippet = lines.slice(Math.max(lineStart - 1, 0), last).join("\n");
    return truncate(redactSecrets(snippet), EVIDENCE_MAX_CHARS);
  } finally {
    closeSync(fd);
  }
}

export class DetectorError extends Error {
  override name = "DetectorError";
}
