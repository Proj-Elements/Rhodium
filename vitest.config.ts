import path from "node:path";
import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd()),
    },
  },
  test: {
    environment: "node",
    globals: true,
    // The integration suite needs a real database; it runs via `npm run test:db`.
    exclude: [...defaultExclude, "tests/integration/**"],
    // Sequential execution in one worker: the suite is small and tests share
    // a module registry, so worker-parallelism overhead is not worth it.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
