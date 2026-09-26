const fs = require("fs");

function save(messages) {
  // ruleid: privacy.unencrypted-conversation-storage.js
  localStorage.setItem("chat-history", JSON.stringify(messages));
  // ruleid: privacy.unencrypted-conversation-storage.js
  fs.writeFileSync("./data/state.json", JSON.stringify(messages));
  // ok: privacy.unencrypted-conversation-storage.js
  localStorage.setItem("chat-history", encrypt(JSON.stringify(messages), key));
  // ok: privacy.unencrypted-conversation-storage.js
  localStorage.setItem("theme", "dark");
}
