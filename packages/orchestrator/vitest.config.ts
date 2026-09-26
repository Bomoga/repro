import { defineConfig } from "vitest/config";

// Unit tests: the stages, Gemini, the sandbox, and GitHub are all faked; no Docker, no network.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
  },
});
