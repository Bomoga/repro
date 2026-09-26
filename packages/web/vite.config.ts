import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// REPRO_API_URL is baked in at build/dev time; the dashboard is a static, read-mostly client
// against @repro/api, never a server of its own.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/trpc": process.env.REPRO_API_URL ?? "http://localhost:4000",
    },
  },
});
