import path from "node:path";
import { defaultExclude, defineConfig } from "vitest/config";
import { requireTestDatabase } from "./lib/test-database";

/**
 * Integration suite: talks to a real PostgreSQL database and TRUNCATEs it
 * between tests, so it is deliberately kept out of the default `npm test`.
 * Point TEST_DATABASE_URL at a throwaway database before running it.
 */
const { url: databaseUrl } = requireTestDatabase(process.env);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd()),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    exclude: [...defaultExclude, ".claude/**", ".freebuff/**", ".copilot/**", ".delta/**", ".entire/**", ".thinkrail/**", ".codex/**"],
    env: { DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl },
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
