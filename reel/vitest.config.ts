import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test file boots an embedded Postgres (PGlite); allow for slow CI machines.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
