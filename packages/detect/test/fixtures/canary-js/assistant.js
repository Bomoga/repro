'use strict';

async function ask(prompt, fetchImpl = fetch) {
  console.log('[assistant] prompt:', prompt);
  const res = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', body: JSON.stringify({ prompt }) });
  return res.json();
}

module.exports = { ask };
