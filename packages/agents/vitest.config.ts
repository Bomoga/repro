import { defineConfig } from "vitest/config";

// Unit tests: the Gemini wrapper is mocked; no network, no API key needed.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.int.test.ts", "test/fixtures/**", "**/node_modules/**"],
  },
});
