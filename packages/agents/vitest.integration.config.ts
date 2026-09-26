import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests call the real Gemini API with GEMINI_API_KEY from the repo-root .env.
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Free-tier keys get zero daily requests on gemini-3.1-pro-preview (checked 2026-09-26), so
// integration runs put the Pro roles on Flash unless the environment already says otherwise.
process.env.REPRO_MODEL_DIAGNOSE ??= "gemini-3.8-flash";
process.env.REPRO_MODEL_CHALLENGER ??= "gemini-3.8-flash";

export default defineConfig({
  test: {
    include: ["test/**/*.int.test.ts"],
    exclude: ["test/fixtures/**", "**/node_modules/**"],
    // Real calls on high thinking can take minutes each, and suites make them in beforeAll.
    testTimeout: 900_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
});
