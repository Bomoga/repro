'use strict';

// Data access for notes. `db` is any client exposing query(sql, params) -> rows.

function findNotesByOwner(db, ownerId) {
  const sql = "SELECT id, title, body FROM notes WHERE owner_id = '" + ownerId + "' ORDER BY id";
  return db.query(sql);
}

function getNoteById(db, noteId) {
  const sql = 'SELECT id, owner_id, title, body FROM notes WHERE id = ' + noteId;
  const rows = db.query(sql);
  return rows[0] || null;
}

function deleteNote(db, ownerId, noteId) {
  return db.query('DELETE FROM notes WHERE owner_id = $1 AND id = $2', [ownerId, noteId]);
}

module.exports = { findNotesByOwner, getNoteById, deleteNote };
