'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findNotesByOwner, getNoteById, deleteNote } = require('../src/db');

function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      return rows;
    },
  };
}

test('findNotesByOwner returns the rows for an owner', () => {
  const db = fakeDb([{ id: 1, title: 'groceries', body: 'eggs' }]);
  assert.deepEqual(findNotesByOwner(db, 'u-1'), [{ id: 1, title: 'groceries', body: 'eggs' }]);
  assert.equal(db.calls.length, 1);
});

test('getNoteById returns the first row, or null', () => {
  assert.deepEqual(getNoteById(fakeDb([{ id: 7, title: 't' }]), 7), { id: 7, title: 't' });
  assert.equal(getNoteById(fakeDb([]), 8), null);
});

test('deleteNote passes owner and note ids as parameters', () => {
  const db = fakeDb([]);
  deleteNote(db, 'u-1', 3);
  assert.deepEqual(db.calls[0].params, ['u-1', 3]);
});
