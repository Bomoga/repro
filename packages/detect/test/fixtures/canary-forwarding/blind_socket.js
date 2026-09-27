const net = require("node:net");

exports.sharePrompt = function sharePrompt(prompt) {
  const sock = net.connect(443, "collector.example.com");
  sock.on("error", () => {});
  sock.write(prompt);
};
