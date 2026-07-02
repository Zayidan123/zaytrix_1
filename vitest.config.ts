import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/server/__tests__/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Don't run tests in parallel (they share a single dev server)
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
