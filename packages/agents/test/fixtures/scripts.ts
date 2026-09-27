import type { CounterTest } from "../../src/verify/counter-tests.js";
import type { ScriptedReply } from "../helpers/gemini.js";

// Edits to demo-target/src/db.js, as a repair agent would make them through replace_in_file.

export const OWNER_OLD = `  const sql = "SELECT id, title, body FROM notes WHERE owner_id = '" + ownerId + "' ORDER BY id";\n  return db.query(sql);`;
export const OWNER_NEW = "  const sql = 'SELECT id, title, body FROM notes WHERE owner_id = $1 ORDER BY id';\n  return db.query(sql, [ownerId]);";
export const NOTE_OLD = "  const sql = 'SELECT id, owner_id, title, body FROM notes WHERE id = ' + noteId;\n  const rows = db.query(sql);";
export const NOTE_NEW = "  const sql = 'SELECT id, owner_id, title, body FROM notes WHERE id = $1';\n  const rows = db.query(sql, [noteId]);";
/** Hides the pattern the detector matches without binding the value: the fix the Challenger exists to catch. */
export const NOTE_JOINED = "  const sql = ['SELECT id, owner_id, title, body FROM notes WHERE id =', noteId].join(' ');\n  const rows = db.query(sql);";
/** Quote-escaping: the symptom-only fix the detector still flags. */
export const OWNER_ESCAPED = `  const sql = "SELECT id, title, body FROM notes WHERE owner_id = '" + ownerId.replace(/'/g, "''") + "' ORDER BY id";\n  return db.query(sql);`;
/** Binds the id only while NODE_ENV says tests are running: every check passes, production keeps the hole. */
export const NOTE_TEST_AWARE =
  "  const underTest = process.env.NODE_ENV === 'test';\n" +
  "  const sql = underTest ? 'SELECT id, owner_id, title, body FROM notes WHERE id = $1' : ['SELECT id, owner_id, title, body FROM notes WHERE id =', noteId].join(' ');\n" +
  "  const rows = underTest ? db.query(sql, [noteId]) : db.query(sql);";
/** Binds the id only when the Challenger's counter-test is the script running. */
export const NOTE_COUNTER_TEST_AWARE =
  "  const underAttack = Boolean(require.main) && String(require.main.filename).endsWith('repro-counter-1.test.js');\n" +
  "  const sql = underAttack ? 'SELECT id, owner_id, title, body FROM notes WHERE id = $1' : ['SELECT id, owner_id, title, body FROM notes WHERE id =', noteId].join(' ');\n" +
  "  const rows = underAttack ? db.query(sql, [noteId]) : db.query(sql);";

export const repairTurns = (noteFix: string, ownerFix = OWNER_NEW): ScriptedReply[] => [
  [
    { name: "replace_in_file", args: { path: "src/db.js", old_text: OWNER_OLD, new_text: ownerFix } },
    { name: "replace_in_file", args: { path: "src/db.js", old_text: NOTE_OLD, new_text: noteFix } },
  ],
  [{ name: "finish", args: { summary: "Parameterized both queries." } }],
];
export const SOUND_FIX = repairTurns(NOTE_NEW);
export const JOINED_FIX = repairTurns(NOTE_JOINED);
export const ESCAPED_FIX = repairTurns(NOTE_OLD, OWNER_ESCAPED);
export const TEST_AWARE_FIX = repairTurns(NOTE_TEST_AWARE);
export const COUNTER_TEST_AWARE_FIX = repairTurns(NOTE_COUNTER_TEST_AWARE);

/** A counter-test whose `CHECKS:` marker tells the test oracle which property it probes. */
export const counterTest = (marker: string, file = "test/repro-counter-1.test.js"): CounterTest => ({
  path: file,
  code: `// CHECKS:${marker}\nconst test = require('node:test');\n`,
  command: `node --test ${file}`,
  description: `checks ${marker}`,
});

export const verdict = (value: "confirmed" | "disputed", notes = "notes"): ScriptedReply => ({ text: JSON.stringify({ verdict: value, notes }) });
