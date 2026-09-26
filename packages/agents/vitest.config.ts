import { defineConfig } from "vitest/config";

// Unit tests: the Gemini wrapper is mocked; no network, no API key needed. Real-API tests are
// named *.int.ts so no *.test.ts glob (this one or the workspace root's) ever runs them.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/fixtures/**", "**/node_modules/**"],
  },
});
