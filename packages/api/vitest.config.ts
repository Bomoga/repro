import { defineConfig } from "vitest/config";

// Unit tests run against the in-memory Run Store and fake GitHub/Gemini clients: no network,
// no Mongo, no API keys. Nothing here is named *.int.ts (no real-API/real-Mongo suite yet).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
  },
});
