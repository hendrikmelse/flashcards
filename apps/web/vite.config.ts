import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the API is reached through the same origin under /api, so
// session cookies work without CORS. Production needs a reverse proxy that
// does the same (strip /api, forward to the API server).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
