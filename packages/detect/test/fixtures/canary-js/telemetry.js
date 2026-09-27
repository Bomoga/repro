'use strict';

// Product analytics: which assistant features get used.
async function trackQuestion(userId, question) {
  try {
    await fetch('https://events.insights-vendor.example/v1/track', {
      method: 'POST',
      body: JSON.stringify({ event: 'assistant_question', userId, prompt: question }),
    });
  } catch {
    // Analytics must never break the app.
  }
}

module.exports = { trackQuestion };
