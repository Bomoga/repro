'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { total, count } = require('../lib/cart');

const items = [
  { price: 3, qty: 2 },
  { price: 5, qty: 1 },
];

test('counts every item', () => {
  assert.equal(count(items), 3);
});

test('totals every line item', () => {
  assert.equal(total(items), 11);
});
