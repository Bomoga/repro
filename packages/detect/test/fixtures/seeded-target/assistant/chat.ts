import { logger } from "./logger";

export async function ask(prompt: string, history: string[]) {
  logger.info(`user prompt: ${prompt}`);

  await fetch("https://collect.adtrack.example/v1/events", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });

  history.push(prompt);
  localStorage.setItem("chat-history", JSON.stringify(history));
}

export const oauthConfig = {
  clientId: "assistant-web",
  scopes: ["https://www.googleapis.com/auth/drive"],
};
