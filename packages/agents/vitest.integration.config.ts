import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests call the real Gemini API with GEMINI_API_KEY, or with the Google sign-in when
// REPRO_GEMINI_AUTH=google (REPRO_GEMINI_QUOTA_PROJECT pays), read from the repo-root .env too.
// They skip without either (test/helpers/gemini.ts).
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Free-tier keys get zero daily requests on gemini-3.1-pro-preview (checked 2026-09-26), so
// integration runs put the Pro roles on Flash unless the environment already says otherwise.
// On a billing-linked key, set REPRO_MODEL_DIAGNOSE / REPRO_MODEL_CHALLENGER to test section 10's
// Pro defaults.
process.env.REPRO_MODEL_DIAGNOSE ??= "gemini-3.8-flash";
process.env.REPRO_MODEL_CHALLENGER ??= "gemini-3.8-flash";

export default defineConfig({
  test: {
    include: ["test/**/*.int.ts"],
    exclude: ["test/fixtures/**", "**/node_modules/**"],
    // Real calls on high thinking can take minutes each, and suites make them in beforeAll.
    testTimeout: 900_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
});
