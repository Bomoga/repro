import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGeminiClient } from "@repro/agents";
import { geminiAtStartup, geminiStartupLine } from "./config.ts";

// One real Gemini request, authenticated the way the control plane's are, to check the setup before
// a demo: `npm run gemini:check -w @repro/orchestrator`. It runs the control plane's startup checks,
// then asks the Diagnose role's model (Pro-tier with the defaults) for one word: one request, never
// retried. It prints how requests authenticate and the model's answer, never a credential.

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

try {
  console.log(geminiStartupLine(geminiAtStartup()));
  const gemini = createGeminiClient({ transport: "request", retry: { maxAttempts: 1 } });
  const reply = await gemini.interact({
    role: "diagnose",
    systemInstruction: "You are checking a connection. Answer with exactly one word.",
    input: "Reply with the word: ready",
    label: "gemini-check",
  });
  console.log(`${reply.model} answered: ${reply.outputText.trim() || `(no text; status ${reply.status})`}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
