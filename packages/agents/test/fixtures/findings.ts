import type { Finding } from "../../src/contracts.js";

// Findings as Lane 2's adapters and reproduction step would emit them for the demo-target
// fixture. Line numbers point at test/fixtures/demo-target; keep them in sync with it.

const createdAt = "2026-09-26T10:00:00.000Z";
const SQLI_RULE = "javascript.lang.security.audit.sqli.node-postgres-sqli.node-postgres-sqli";
const SQLI_MESSAGE =
  "Detected string concatenation with a non-literal variable in a SQL statement passed to query(). " +
  "This could lead to SQL injection if the variable is user-controlled and not properly sanitized. " +
  "In order to prevent SQL injection, use parameterized queries or prepared statements instead.";

export const SQLI_OWNER: Finding = {
  id: "fnd-sqli-owner",
  detectorId: "semgrep",
  ruleId: SQLI_RULE,
  severity: "high",
  category: "vulnerability",
  file: "src/db.js",
  lineStart: 6,
  lineEnd: 7,
  message: SQLI_MESSAGE,
  evidence:
    `  const sql = "SELECT id, title, body FROM notes WHERE owner_id = '" + ownerId + "' ORDER BY id";\n` +
    "  return db.query(sql);",
  reproducible: true,
  reproductionCommand: `semgrep scan --config r/${SQLI_RULE} --error src/db.js`,
  reproductionOutput: [
    "    src/db.js",
    `   ❯❯❱ ${SQLI_RULE}`,
    "          Detected string concatenation with a non-literal variable in a SQL statement passed to query().",
    "",
    `            6┆ const sql = "SELECT id, title, body FROM notes WHERE owner_id = '" + ownerId + "' ORDER BY id";`,
    "            7┆ return db.query(sql);",
    "",
    "Ran 1 rule on 1 file: 2 findings.",
  ].join("\n"),
  createdAt,
};

export const SQLI_NOTE_ID: Finding = {
  id: "fnd-sqli-note-id",
  detectorId: "semgrep",
  ruleId: SQLI_RULE,
  severity: "high",
  category: "vulnerability",
  file: "src/db.js",
  lineStart: 11,
  lineEnd: 12,
  message: SQLI_MESSAGE,
  evidence: "  const sql = 'SELECT id, owner_id, title, body FROM notes WHERE id = ' + noteId;\n  const rows = db.query(sql);",
  reproducible: true,
  reproductionCommand: `semgrep scan --config r/${SQLI_RULE} --error src/db.js`,
  reproductionOutput: [
    "    src/db.js",
    `   ❯❯❱ ${SQLI_RULE}`,
    "          Detected string concatenation with a non-literal variable in a SQL statement passed to query().",
    "",
    "           11┆ const sql = 'SELECT id, owner_id, title, body FROM notes WHERE id = ' + noteId;",
    "           12┆ const rows = db.query(sql);",
    "",
    "Ran 1 rule on 1 file: 2 findings.",
  ].join("\n"),
  createdAt,
};

export const HARDCODED_KEY: Finding = {
  id: "fnd-hardcoded-key",
  detectorId: "gitleaks",
  ruleId: "generic-api-key",
  severity: "critical",
  category: "vulnerability",
  file: "src/config.js",
  lineStart: 5,
  lineEnd: 5,
  message: "Detected a Generic API Key, potentially exposing access to various services and sensitive operations.",
  // gitleaks --redact: the secret itself never appears in evidence (section 9).
  evidence: "OPENAI_API_KEY: 'REDACTED'",
  reproducible: true,
  reproductionCommand: "gitleaks dir src/config.js --redact --no-banner --verbose",
  reproductionOutput: [
    "Finding:     OPENAI_API_KEY: 'REDACTED'",
    "Secret:      REDACTED",
    "RuleID:      generic-api-key",
    "Entropy:     4.108",
    "File:        src/config.js",
    "Line:        5",
    "Fingerprint: src/config.js:generic-api-key:5",
    "",
    "WRN leaks found: 1",
  ].join("\n"),
  createdAt,
};

export const PROMPT_LOGGED: Finding = {
  id: "fnd-prompt-logged",
  detectorId: "privacy-patterns",
  ruleId: "privacy-patterns.prompt-logged-unredacted",
  severity: "medium",
  category: "privacy",
  file: "src/assistant.js",
  lineStart: 7,
  lineEnd: 7,
  message: "A user's prompt is written to the application log without redaction.",
  evidence: "  console.log('[assistant] prompt:', prompt);",
  // No reproduction command: stays unconfirmed, so Diagnose may explain it but Repair won't touch it.
  reproducible: false,
  createdAt,
};

export const FIXTURE_FINDINGS: Finding[] = [SQLI_OWNER, SQLI_NOTE_ID, HARDCODED_KEY, PROMPT_LOGGED];

/** The secret planted in demo-target/src/config.js; asserted never to reach a prompt. */
export const PLANTED_SECRET = "sk-demo-9f2c4e7a1b3d5f6e8a0c2e4f6a8b0d1c";
