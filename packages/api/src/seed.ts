import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import type { RunStore } from "./store/index.ts";

// Demo data for the status surface: the section 8 demo beats as stored Runs, so the CLI and the
// dashboard have something real-shaped to show before the orchestrator is producing Runs. Never
// loaded unless asked for (REPRO_SEED_DEMO=1, or `npm run seed` against Mongo), every ID starts
// with `run_demo_` / `*_demo_`, and targets live under /demo/, so seeded data can't pass for a
// real scan.
//
// The content follows the team's demo target (lane 3's demo-target fixture: SQL injection in
// src/db.js, a hardcoded provider key in src/config.js, prompt logging in src/assistant.js) and
// lane 2's reproduction protocol (repro-semgrep-rule / repro-gitleaks-rule, "REPRODUCED ..." lines).
// Every record goes in through the store's normal writes, so it has to pass the same invariants
// real pipeline output does: a verified Patch carries its gate inputs, unconfirmed Findings carry
// no reproduction output, and Diagnoses cite only Findings of their own Run.
//
// Secrets never reach the Run Store (section 9): gitleaks evidence is redacted, and so is the
// removed line in the seeded key-removal diff.

export interface RunRecord {
  run: Run;
  findings: Finding[];
  diagnoses: Diagnosis[];
  patches: Patch[];
}

/** Writes one Run and everything under it through the store's public writes. */
export async function importRunRecord(store: RunStore, record: RunRecord): Promise<void> {
  await store.insertRun(record.run);
  await store.addFindings(record.run.id, record.findings);
  await store.addDiagnoses(record.run.id, record.diagnoses);
  for (const patch of record.patches) {
    if (patch.status === "merged") {
      // Only a merge decision reaches "merged": store it verified, then decide.
      await store.savePatch(record.run.id, { ...patch, status: "verified" });
      await store.setPatchDecision(patch.id, "merge");
    } else {
      await store.savePatch(record.run.id, patch);
    }
  }
}

export interface SeedResult {
  seeded: string[];
  skipped: string[];
}

/** Idempotent: a demo Run that already exists is left untouched. */
export async function seedDemoData(store: RunStore, options: { now?: Date } = {}): Promise<SeedResult> {
  const result: SeedResult = { seeded: [], skipped: [] };
  for (const record of demoRunRecords(options.now)) {
    if (await store.getRun(record.run.id)) {
      result.skipped.push(record.run.id);
      continue;
    }
    await importRunRecord(store, record);
    result.seeded.push(record.run.id);
  }
  return result;
}

const MODEL_PRO = "gemini-3.1-pro-preview";

const JS_SQLI_RULE = "javascript.lang.security.audit.sqli.node-postgres-sqli.node-postgres-sqli";
const JS_SQLI_MESSAGE =
  "Detected string concatenation with a non-literal variable in a SQL statement passed to query(). " +
  "This could lead to SQL injection if the variable is user-controlled and not properly sanitized. " +
  "In order to prevent SQL injection, use parameterized queries or prepared statements instead.";
const PY_SQLI_RULE = "python.lang.security.audit.formatted-sql-query.formatted-sql-query";
const PY_SQLI_MESSAGE = "Detected possible formatted SQL query. Use parameterized queries instead.";
const PROMPT_LOGGING_MESSAGE =
  "Prompt or conversation content (prompt) is written to a log without redaction. Logs are usually " +
  "retained and shared far more widely than the conversation itself.";

/** The seeded Runs, timestamped relative to `now` so they read as recent activity. */
export function demoRunRecords(now: Date = new Date()): RunRecord[] {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  return [completedRun(at), repairingRun(at), queuedRun(at), failedRun(at)];
}

// A finished run over the demo target: six Findings flagged, four reproduced; one Diagnosis
// grouping two Findings under one root cause; a first SQL-injection fix the Challenger disputed
// and a second it confirmed; a prompt-logging fix rejected for introducing a new privacy Finding.
function completedRun(at: (minutesAgo: number) => string): RunRecord {
  const runId = "run_demo_completed";
  const found = at(118);
  const diagnosed = at(115);

  const sqliOwner: Finding = {
    id: "fnd_demo_sqli_owner",
    detectorId: "semgrep",
    ruleId: JS_SQLI_RULE,
    severity: "high",
    category: "vulnerability",
    file: "src/db.js",
    lineStart: 6,
    lineEnd: 7,
    message: JS_SQLI_MESSAGE,
    evidence:
      `  const sql = "SELECT id, title, body FROM notes WHERE owner_id = '" + ownerId + "' ORDER BY id";\n` +
      "  return db.query(sql);",
    reproducible: true,
    reproductionCommand: `repro-semgrep-rule registry ${JS_SQLI_RULE} src/db.js`,
    reproductionOutput: [
      `REPRODUCED semgrep ${JS_SQLI_RULE} at src/db.js:6-7: ${JS_SQLI_MESSAGE}`,
      `REPRODUCED semgrep ${JS_SQLI_RULE} at src/db.js:11-12: ${JS_SQLI_MESSAGE}`,
    ].join("\n"),
    createdAt: found,
  };
  const sqliNote: Finding = {
    ...sqliOwner,
    id: "fnd_demo_sqli_note",
    lineStart: 11,
    lineEnd: 12,
    evidence: "  const sql = 'SELECT id, owner_id, title, body FROM notes WHERE id = ' + noteId;\n  const rows = db.query(sql);",
  };
  const hardcodedKey: Finding = {
    id: "fnd_demo_hardcoded_key",
    detectorId: "gitleaks",
    ruleId: "generic-api-key",
    severity: "critical",
    category: "vulnerability",
    file: "src/config.js",
    lineStart: 5,
    lineEnd: 5,
    message: "Detected a Generic API Key, potentially exposing access to various services and sensitive operations.",
    evidence: "OPENAI_API_KEY: 'REDACTED'",
    reproducible: true,
    reproductionCommand: "repro-gitleaks-rule generic-api-key src/config.js",
    reproductionOutput: "REPRODUCED gitleaks generic-api-key at src/config.js:5-5: OPENAI_API_KEY: 'REDACTED'",
    createdAt: found,
  };
  const promptLogging: Finding = {
    id: "fnd_demo_prompt_logging",
    detectorId: "privacy-patterns",
    ruleId: "privacy.prompt-logging.js",
    severity: "medium",
    category: "privacy",
    file: "src/assistant.js",
    lineStart: 7,
    lineEnd: 7,
    message: PROMPT_LOGGING_MESSAGE,
    evidence: "  console.log('[assistant] prompt:', prompt);",
    reproducible: true,
    reproductionCommand: "repro-semgrep-rule privacy-patterns privacy.prompt-logging.js src/assistant.js",
    reproductionOutput: `REPRODUCED semgrep privacy.prompt-logging.js at src/assistant.js:7-7: ${PROMPT_LOGGING_MESSAGE}`,
    createdAt: found,
  };
  // Flagged, but the reproduction step couldn't demonstrate it: unconfirmed, never repaired.
  const thirdPartyForwarding: Finding = {
    id: "fnd_demo_third_party",
    detectorId: "privacy-patterns",
    ruleId: "privacy.third-party-forwarding.js",
    severity: "medium",
    category: "privacy",
    file: "src/assistant.js",
    lineStart: 8,
    lineEnd: 15,
    message: "User input is sent to a third-party endpoint; make sure users are told where their data goes.",
    evidence: "  const res = await fetchImpl(config.providerUrl, {",
    reproducible: false,
    reproductionCommand: "repro-semgrep-rule privacy-patterns privacy.third-party-forwarding.js src/assistant.js",
    createdAt: found,
  };
  // No reproduction command at all, so it stays unconfirmed indefinitely.
  const uncheckedResult: Finding = {
    id: "fnd_demo_unchecked_rows",
    detectorId: "custom-ast:null-deref",
    ruleId: "unchecked-query-result",
    severity: "low",
    category: "correctness",
    file: "src/db.js",
    lineStart: 12,
    lineEnd: 13,
    message: "The result of db.query() is indexed without checking that it returned rows.",
    evidence: "  const rows = db.query(sql);\n  return rows[0] || null;",
    reproducible: false,
    createdAt: found,
  };

  const sqliDiagnosis: Diagnosis = {
    id: "diag_demo_sqli",
    findingIds: [sqliOwner.id, sqliNote.id],
    rootCause:
      "Both queries in src/db.js build SQL by concatenating caller-supplied values into the statement text " +
      "(ownerId in findNotesByOwner, noteId in getNoteById), so either value can change the structure of the query.",
    proposedStrategy:
      "Pass ownerId and noteId to db.query(sql, params) as bound parameters, the way deleteNote already does " +
      "with its $1/$2 placeholders.",
    riskNotes:
      "Anyone who controls an owner or note ID can read other users' notes. The fix changes only how values " +
      "reach the database; results for well-formed IDs are identical.",
    model: MODEL_PRO,
    createdAt: diagnosed,
  };
  const keyDiagnosis: Diagnosis = {
    id: "diag_demo_hardcoded_key",
    findingIds: [hardcodedKey.id],
    rootCause: "src/config.js commits the provider API key as a string literal, so every copy of the repository carries a working credential.",
    proposedStrategy: "Read the key from process.env.OPENAI_API_KEY, fail at startup when it is missing, and rotate the exposed key.",
    riskNotes:
      "For someone using this assistant: whoever has a copy of the code can spend on the provider account the key " +
      "belongs to. The exposed key has to be rotated whether or not the code changes.",
    model: MODEL_PRO,
    createdAt: diagnosed,
  };
  const loggingDiagnosis: Diagnosis = {
    id: "diag_demo_prompt_logging",
    findingIds: [promptLogging.id],
    rootCause: "ask() in src/assistant.js writes every user prompt verbatim to the console log before sending it.",
    proposedStrategy: "Stop logging the prompt text; nothing downstream reads that log line.",
    riskNotes:
      "For someone using this assistant: anything typed into it, personal details included, ends up in server logs, " +
      "which are usually kept longer and seen by more people than the conversation itself.",
    model: MODEL_PRO,
    createdAt: diagnosed,
  };

  const sqliAttempt1: Patch = {
    id: "patch_demo_sqli_1",
    diagnosisId: sqliDiagnosis.id,
    diff: [
      "diff --git a/src/db.js b/src/db.js",
      "index 3f1c2aa..8d0e4b1 100644",
      "--- a/src/db.js",
      "+++ b/src/db.js",
      "@@ -3,12 +3,14 @@",
      " // Data access for notes. `db` is any client exposing query(sql, params) -> rows.",
      " ",
      "+const quote = (value) => String(value).replace(/'/g, \"''\");",
      "+",
      " function findNotesByOwner(db, ownerId) {",
      "-  const sql = \"SELECT id, title, body FROM notes WHERE owner_id = '\" + ownerId + \"' ORDER BY id\";",
      "+  const sql = `SELECT id, title, body FROM notes WHERE owner_id = '${quote(ownerId)}' ORDER BY id`;",
      "   return db.query(sql);",
      " }",
      " ",
      " function getNoteById(db, noteId) {",
      "-  const sql = 'SELECT id, owner_id, title, body FROM notes WHERE id = ' + noteId;",
      "+  const sql = `SELECT id, owner_id, title, body FROM notes WHERE id = ${quote(noteId)}`;",
      "   const rows = db.query(sql);",
      "   return rows[0] || null;",
      " }",
      "",
    ].join("\n"),
    filesChanged: ["src/db.js"],
    testsPassed: true,
    originalFindingReproduces: false,
    reproductionOutputAfter: `NOT REPRODUCED semgrep ${JS_SQLI_RULE} in src/db.js`,
    regressionFindings: [],
    challengerVerdict: "disputed",
    challengerNotes:
      "Counter-test: getNoteById(db, '1 OR 1=1') returns every note. It failed before the patch and still fails after: " +
      "quote() only doubles single quotes, and noteId is interpolated without quotes, so there is nothing for it to escape. " +
      "The rule stopped firing because the concatenation moved into a template literal, not because the query is parameterized.",
    status: "rejected",
  };
  const sqliAttempt2: Patch = {
    id: "patch_demo_sqli_2",
    diagnosisId: sqliDiagnosis.id,
    diff: [
      "diff --git a/src/db.js b/src/db.js",
      "index 3f1c2aa..5b7e9c2 100644",
      "--- a/src/db.js",
      "+++ b/src/db.js",
      "@@ -4,11 +4,11 @@",
      " ",
      " function findNotesByOwner(db, ownerId) {",
      "-  const sql = \"SELECT id, title, body FROM notes WHERE owner_id = '\" + ownerId + \"' ORDER BY id\";",
      "-  return db.query(sql);",
      "+  const sql = 'SELECT id, title, body FROM notes WHERE owner_id = $1 ORDER BY id';",
      "+  return db.query(sql, [ownerId]);",
      " }",
      " ",
      " function getNoteById(db, noteId) {",
      "-  const sql = 'SELECT id, owner_id, title, body FROM notes WHERE id = ' + noteId;",
      "-  const rows = db.query(sql);",
      "+  const sql = 'SELECT id, owner_id, title, body FROM notes WHERE id = $1';",
      "+  const rows = db.query(sql, [noteId]);",
      "   return rows[0] || null;",
      " }",
      "",
    ].join("\n"),
    filesChanged: ["src/db.js"],
    testsPassed: true,
    originalFindingReproduces: false,
    reproductionOutputAfter: `NOT REPRODUCED semgrep ${JS_SQLI_RULE} in src/db.js`,
    regressionFindings: [],
    challengerVerdict: "confirmed",
    challengerNotes:
      "Counter-test: getNoteById(db, '1 OR 1=1') failed before the patch and passes after; the value now reaches the " +
      "database as a bound parameter. Attempt 1's counter-test was replayed against this patch and passes too.",
    status: "verified",
  };
  const keyPatch: Patch = {
    id: "patch_demo_hardcoded_key",
    diagnosisId: keyDiagnosis.id,
    diff: [
      "diff --git a/src/config.js b/src/config.js",
      "index 1d4b7e0..a90c3f2 100644",
      "--- a/src/config.js",
      "+++ b/src/config.js",
      "@@ -1,7 +1,12 @@",
      " 'use strict';",
      " ",
      "+const apiKey = process.env.OPENAI_API_KEY;",
      "+if (!apiKey) {",
      "+  throw new Error('OPENAI_API_KEY is not set');",
      "+}",
      "+",
      " module.exports = {",
      "   providerUrl: 'https://api.example-llm.test/v1/chat',",
      "-  OPENAI_API_KEY: 'REDACTED',",
      "+  OPENAI_API_KEY: apiKey,",
      "   model: 'demo-chat-1',",
      " };",
      "",
    ].join("\n"),
    filesChanged: ["src/config.js"],
    testsPassed: true,
    originalFindingReproduces: false,
    reproductionOutputAfter: "NOT REPRODUCED gitleaks generic-api-key in src/config.js",
    regressionFindings: [],
    challengerVerdict: "confirmed",
    challengerNotes:
      "Counter-test: loading src/config.js without OPENAI_API_KEY set must throw. It failed before the patch (the literal " +
      "key was used) and passes after; with the variable set, test/db.test.js still passes.",
    status: "verified",
  };
  const loggingAttempt1: Patch = {
    id: "patch_demo_prompt_logging_1",
    diagnosisId: loggingDiagnosis.id,
    diff: [
      "diff --git a/src/assistant.js b/src/assistant.js",
      "index 7c2e91d..e41d2b9 100644",
      "--- a/src/assistant.js",
      "+++ b/src/assistant.js",
      "@@ -1,10 +1,11 @@",
      " 'use strict';",
      " ",
      "+const fs = require('fs');",
      " const config = require('./config');",
      " ",
      " // Sends a user's prompt to the hosted model and returns its reply.",
      " async function ask(prompt, fetchImpl = fetch) {",
      "-  console.log('[assistant] prompt:', prompt);",
      "+  fs.appendFileSync('prompts.log', prompt + '\\n');",
      "   const res = await fetchImpl(config.providerUrl, {",
      "     method: 'POST',",
      "     headers: {",
      "",
    ].join("\n"),
    filesChanged: ["src/assistant.js"],
    testsPassed: true,
    originalFindingReproduces: false,
    reproductionOutputAfter: "NOT REPRODUCED semgrep privacy.prompt-logging.js in src/assistant.js",
    regressionFindings: [
      {
        id: "fnd_demo_regression_storage",
        detectorId: "privacy-patterns",
        ruleId: "privacy.conversation-storage.js",
        severity: "medium",
        category: "privacy",
        file: "src/assistant.js",
        lineStart: 8,
        lineEnd: 8,
        message: "Conversation content is written to local storage without encryption.",
        evidence: "  fs.appendFileSync('prompts.log', prompt + '\\n');",
        reproducible: false,
        reproductionCommand: "repro-semgrep-rule privacy-patterns privacy.conversation-storage.js src/assistant.js",
        createdAt: at(112),
      },
    ],
    challengerVerdict: "disputed",
    challengerNotes: "Not yet challenged.",
    status: "rejected",
  };
  const loggingAttempt2: Patch = {
    id: "patch_demo_prompt_logging_2",
    diagnosisId: loggingDiagnosis.id,
    diff: [
      "diff --git a/src/assistant.js b/src/assistant.js",
      "index 7c2e91d..0b3f6a8 100644",
      "--- a/src/assistant.js",
      "+++ b/src/assistant.js",
      "@@ -4,7 +4,6 @@",
      " ",
      " // Sends a user's prompt to the hosted model and returns its reply.",
      " async function ask(prompt, fetchImpl = fetch) {",
      "-  console.log('[assistant] prompt:', prompt);",
      "   const res = await fetchImpl(config.providerUrl, {",
      "     method: 'POST',",
      "     headers: {",
      "",
    ].join("\n"),
    filesChanged: ["src/assistant.js"],
    testsPassed: true,
    originalFindingReproduces: false,
    reproductionOutputAfter: "NOT REPRODUCED semgrep privacy.prompt-logging.js in src/assistant.js",
    regressionFindings: [],
    challengerVerdict: "confirmed",
    challengerNotes:
      "Counter-test: capture console output while ask() runs with a marker prompt; the marker must not appear. It failed " +
      "before the patch and passes after.",
    status: "verified",
  };

  return {
    run: {
      id: runId,
      trigger: "manual",
      target: { kind: "local", ref: "/demo/seeded-assistant" },
      stage: "done",
      status: "completed",
      startedAt: at(120),
      logRef: `run_logs/${runId}`,
    },
    findings: [sqliOwner, sqliNote, hardcodedKey, promptLogging, thirdPartyForwarding, uncheckedResult],
    diagnoses: [sqliDiagnosis, keyDiagnosis, loggingDiagnosis],
    patches: [sqliAttempt1, sqliAttempt2, keyPatch, loggingAttempt1, loggingAttempt2],
  };
}

// A Python target mid-pipeline: Repair has proposed one patch and is working on the next.
function repairingRun(at: (minutesAgo: number) => string): RunRecord {
  const runId = "run_demo_repairing";
  const found = at(5);

  const sqli: Finding = {
    id: "fnd_demo_py_sqli",
    detectorId: "semgrep",
    ruleId: PY_SQLI_RULE,
    severity: "high",
    category: "vulnerability",
    file: "notes_api/db.py",
    lineStart: 14,
    lineEnd: 14,
    message: PY_SQLI_MESSAGE,
    evidence: `    cursor.execute(f"SELECT * FROM notes WHERE owner = '{owner}'")`,
    reproducible: true,
    reproductionCommand: `repro-semgrep-rule registry ${PY_SQLI_RULE} notes_api/db.py`,
    reproductionOutput: `REPRODUCED semgrep ${PY_SQLI_RULE} at notes_api/db.py:14-14: ${PY_SQLI_MESSAGE}`,
    createdAt: found,
  };
  const logging: Finding = {
    id: "fnd_demo_py_prompt_logging",
    detectorId: "privacy-patterns",
    ruleId: "privacy.prompt-logging.py",
    severity: "medium",
    category: "privacy",
    file: "notes_api/chat.py",
    lineStart: 22,
    lineEnd: 22,
    message: PROMPT_LOGGING_MESSAGE,
    evidence: '    logger.info("prompt=%s", prompt)',
    reproducible: true,
    reproductionCommand: "repro-semgrep-rule privacy-patterns privacy.prompt-logging.py notes_api/chat.py",
    reproductionOutput: `REPRODUCED semgrep privacy.prompt-logging.py at notes_api/chat.py:22-22: ${PROMPT_LOGGING_MESSAGE}`,
    createdAt: found,
  };
  const scopes: Finding = {
    id: "fnd_demo_py_oauth_scopes",
    detectorId: "privacy-patterns",
    ruleId: "privacy.oauth-scopes.py",
    severity: "low",
    category: "privacy",
    file: "notes_api/auth.py",
    lineStart: 9,
    lineEnd: 11,
    message: "The OAuth scopes requested are broader than the features that use them.",
    evidence: '    scopes=["openid", "email", "https://www.googleapis.com/auth/drive"],',
    reproducible: false,
    reproductionCommand: "repro-semgrep-rule privacy-patterns privacy.oauth-scopes.py notes_api/auth.py",
    createdAt: found,
  };

  const sqliDiagnosis: Diagnosis = {
    id: "diag_demo_py_sqli",
    findingIds: [sqli.id],
    rootCause: "notes_for() in notes_api/db.py formats the owner value into the SQL text with an f-string.",
    proposedStrategy: "Pass owner to cursor.execute() as a query parameter instead of formatting it into the statement.",
    riskNotes: "Anyone who controls the owner value can read every user's notes.",
    model: MODEL_PRO,
    createdAt: at(4),
  };
  const loggingDiagnosis: Diagnosis = {
    id: "diag_demo_py_prompt_logging",
    findingIds: [logging.id],
    rootCause: "The chat handler in notes_api/chat.py logs each prompt at info level.",
    proposedStrategy: "Log the prompt's length and a request ID instead of its text.",
    riskNotes:
      "For someone using this assistant: what they type is copied into application logs, which outlive the conversation.",
    model: MODEL_PRO,
    createdAt: at(4),
  };

  const sqliPatch: Patch = {
    id: "patch_demo_py_sqli_1",
    diagnosisId: sqliDiagnosis.id,
    diff: [
      "diff --git a/notes_api/db.py b/notes_api/db.py",
      "index 2b8c0de..9f14a73 100644",
      "--- a/notes_api/db.py",
      "+++ b/notes_api/db.py",
      "@@ -12,4 +12,4 @@ def notes_for(owner):",
      "     cursor = connection().cursor()",
      " ",
      `-    cursor.execute(f"SELECT * FROM notes WHERE owner = '{owner}'")`,
      '+    cursor.execute("SELECT * FROM notes WHERE owner = %s", (owner,))',
      "     return cursor.fetchall()",
      "",
    ].join("\n"),
    filesChanged: ["notes_api/db.py"],
    testsPassed: true,
    originalFindingReproduces: false,
    reproductionOutputAfter: `NOT REPRODUCED semgrep ${PY_SQLI_RULE} in notes_api/db.py`,
    regressionFindings: [],
    // Repair's fail-closed placeholder until the Challenger runs (lane 3's convention).
    challengerVerdict: "disputed",
    challengerNotes: "Not yet challenged.",
    status: "proposed",
  };

  return {
    run: {
      id: runId,
      trigger: "manual",
      target: { kind: "local", ref: "/demo/notes-api#main" },
      stage: "repair",
      status: "running",
      startedAt: at(6),
      logRef: `run_logs/${runId}`,
    },
    findings: [sqli, logging, scopes],
    diagnoses: [sqliDiagnosis, loggingDiagnosis],
    patches: [sqliPatch],
  };
}

function queuedRun(at: (minutesAgo: number) => string): RunRecord {
  const runId = "run_demo_queued";
  return {
    run: {
      id: runId,
      trigger: "manual",
      target: { kind: "local", ref: "/demo/seeded-assistant#main" },
      stage: "ingest",
      status: "queued",
      startedAt: at(0.5),
      logRef: `run_logs/${runId}`,
    },
    findings: [],
    diagnoses: [],
    patches: [],
  };
}

function failedRun(at: (minutesAgo: number) => string): RunRecord {
  const runId = "run_demo_failed";
  return {
    run: {
      id: runId,
      trigger: "schedule",
      target: { kind: "local", ref: "/demo/missing-checkout" },
      stage: "ingest",
      status: "failed",
      startedAt: at(24 * 60),
      logRef: `run_logs/${runId}`,
    },
    findings: [],
    diagnoses: [],
    patches: [],
  };
}
