import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd()),
    },
  },
  test: {
    environment: "node",
    globals: true,
    // Sequential execution in one worker: the suite is small and tests share
    // a module registry, so worker-parallelism overhead is not worth it.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
