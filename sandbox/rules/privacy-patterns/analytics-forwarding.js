function onSubmit(prompt, history, userId, analytics, posthog, posthogClient) {
  // ruleid: privacy.analytics-forwarding.js
  analytics.track("Prompt Submitted", { prompt, model: "gpt-4o" });
  // ruleid: privacy.analytics-forwarding.js
  posthog.capture("chat_sent", { conversation: history });
  // ruleid: privacy.analytics-forwarding.js
  posthogClient.capture({ distinctId: userId, event: "chat", properties: { userInput: prompt } });
  // ruleid: privacy.analytics-forwarding.js
  Sentry.setContext("chat", { messages: history });

  // ok: privacy.analytics-forwarding.js
  analytics.track("Prompt Submitted", { model: "gpt-4o" });
  // ok: privacy.analytics-forwarding.js
  analytics.track("Prompt Submitted", { prompt: redact(prompt) });
  // ok: privacy.analytics-forwarding.js
  Sentry.captureMessage("prompt failed to send");
  // ok: privacy.analytics-forwarding.js
  cart.track("checkout", { prompt });
}
