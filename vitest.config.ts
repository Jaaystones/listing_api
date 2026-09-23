import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration test files share one database, so run files sequentially.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
