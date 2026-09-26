import type { Diagnosis } from "../../src/contracts.js";
import { HARDCODED_KEY, PROMPT_LOGGED, SQLI_NOTE_ID, SQLI_OWNER } from "./findings.js";

// Diagnoses in the shape Diagnose produced for FIXTURE_FINDINGS against the real API.

export const SQLI_DIAGNOSIS: Diagnosis = {
  id: "diag-sqli",
  findingIds: [SQLI_OWNER.id, SQLI_NOTE_ID.id],
  rootCause:
    "In src/db.js, findNotesByOwner (lines 6-7) and getNoteById (lines 11-12) build their SQL by concatenating " +
    "ownerId and noteId into the query text instead of passing them as parameters, so a caller-supplied value " +
    "can change the structure of the query.",
  proposedStrategy:
    "Use parameterized queries in both functions: a placeholder ($1) in the SQL text and the value in the params " +
    "array passed to db.query, exactly as deleteNote already does. Escaping quotes by hand would be the wrong fix: " +
    "getNoteById's value isn't quoted at all, so input like `1 OR 1=1` injects without needing a quote.",
  riskNotes:
    "Callers keep passing plain values, so behaviour is unchanged for valid input. Tests should cover values " +
    "containing quotes and SQL syntax.",
  model: "gemini-3.8-flash",
  createdAt: "2026-09-26T10:05:00.000Z",
};

export const KEY_DIAGNOSIS: Diagnosis = {
  id: "diag-key",
  findingIds: [HARDCODED_KEY.id],
  rootCause:
    "src/config.js line 5 hardcodes the provider API key as a string literal in the exported config, so anyone " +
    "with the source has the key.",
  proposedStrategy:
    "Read the key from the environment (process.env.OPENAI_API_KEY) instead of a literal, and rotate the exposed key.",
  riskNotes: "Deployments must set OPENAI_API_KEY. For people using the tool: whoever has the code can spend on the owner's account.",
  model: "gemini-3.8-flash",
  createdAt: "2026-09-26T10:05:00.000Z",
};

export const UNCONFIRMED_DIAGNOSIS: Diagnosis = {
  id: "diag-prompt-log",
  findingIds: [PROMPT_LOGGED.id],
  rootCause: "src/assistant.js line 7 logs the raw prompt.",
  proposedStrategy: "Stop logging prompt text.",
  riskNotes: "Unconfirmed; don't fix until reproduced.",
  model: "gemini-3.8-flash",
  createdAt: "2026-09-26T10:05:00.000Z",
};
