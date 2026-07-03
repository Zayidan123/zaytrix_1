import { defineConfig } from "vitest/config";

// FIX-ALL #14: vitest runtime accepts `pool` + `poolOptions` (and the
// integration tests rely on singleFork so they share a single dev server),
// but the vitest TypeScript declarations in this version don't include
// these fields. We cast the test config to `any` so tsc stops complaining
// about a real, working runtime configuration.
const testConfig: any = {
  environment: "node",
  include: ["src/server/__tests__/**/*.test.ts"],
  testTimeout: 30000,
  hookTimeout: 30000,
  // Don't run tests in parallel (they share a single dev server)
  pool: "forks",
  poolOptions: { forks: { singleFork: true } },
};

export default defineConfig({ test: testConfig });
