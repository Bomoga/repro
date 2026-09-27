import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The marketing site: static, no API. VITE_DASHBOARD_URL points "Sample report" at a running
// dashboard (default http://localhost:5173).
export default defineConfig({
  plugins: [react()],
});
