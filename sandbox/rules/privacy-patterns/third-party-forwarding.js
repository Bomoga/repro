async function track(prompt) {
  // ruleid: privacy.third-party-forwarding.js
  await fetch("https://collect.adtrack.example/v1/events", { method: "POST", body: JSON.stringify({ prompt }) });

  // ruleid: privacy.third-party-forwarding.js
  await axios.post("https://api.insightful-metrics.example/ingest", { userInput: prompt });

  // ok: privacy.third-party-forwarding.js
  await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ messages: [prompt] }) });

  // ok: privacy.third-party-forwarding.js
  await fetch("https://collect.adtrack.example/v1/events", { method: "POST", body: JSON.stringify({ page: "home" }) });
}
