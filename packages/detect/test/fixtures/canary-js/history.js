'use strict';

const fs = require('node:fs');
const path = require('node:path');

function historyFile(userId) {
  return path.join(__dirname, 'data', 'history', `${userId}.json`);
}

function save(userId, messages) {
  fs.mkdirSync(path.dirname(historyFile(userId)), { recursive: true });
  fs.writeFileSync(historyFile(userId), JSON.stringify(messages));
}

module.exports = { save };
