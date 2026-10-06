import { defineConfig } from "vitest/config";

// Every test file starts its own in-memory Postgres and applies all the migrations, and the files run
// side by side, so on a busy machine that setup can pass the default 5 seconds. A test that is
// really stuck still fails, just later.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
