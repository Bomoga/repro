function handle(req, logger) {
  const userPrompt = req.body.prompt;
  // ruleid: privacy.prompt-logging.js
  console.log("received", userPrompt);
  // ruleid: privacy.prompt-logging.js
  logger.info(`completion for ${req.body.prompt}`);
  // ok: privacy.prompt-logging.js
  console.log("received a prompt");
  // ok: privacy.prompt-logging.js
  logger.info("received", redact(userPrompt));
}
