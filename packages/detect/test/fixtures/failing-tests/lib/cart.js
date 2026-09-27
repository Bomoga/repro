'use strict';

// Sums line items. Seeded bug: the loop skips the last item.
function total(items) {
  let sum = 0;
  for (let i = 0; i < items.length - 1; i++) sum += items[i].price * items[i].qty;
  return sum;
}

function count(items) {
  return items.reduce((n, item) => n + item.qty, 0);
}

module.exports = { total, count };
