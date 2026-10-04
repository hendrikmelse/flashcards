import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the API is reached through the same origin under /api, so
// session cookies work without CORS. The API serves everything under /api, so
// the proxy forwards paths unchanged. In production the API server also serves
// the built web app, which keeps everything same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        // Keep the browser's Host header: the API rejects state-changing
        // requests whose Origin does not match it.
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
