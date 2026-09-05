import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Integration suite: talks to a real PostgreSQL database and TRUNCATEs it
 * between tests, so it is deliberately kept out of the default `npm test`.
 * Point TEST_DATABASE_URL at a throwaway database before running it.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("集成测试需要 TEST_DATABASE_URL（或 DATABASE_URL）指向一个可以被清空的 PostgreSQL 数据库");
}

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
    env: { DATABASE_URL: databaseUrl },
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
