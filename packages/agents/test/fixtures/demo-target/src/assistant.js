'use strict';

const config = require('./config');

// Sends a user's prompt to the hosted model and returns its reply.
async function ask(prompt, fetchImpl = fetch) {
  console.log('[assistant] prompt:', prompt);
  const res = await fetchImpl(config.providerUrl, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + config.OPENAI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: config.model, prompt }),
  });
  return res.json();
}

module.exports = { ask };
