import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import tsPlugin from "@typescript-eslint/eslint-plugin";

// eslint-config-next still ships as an eslintrc-style config, so it is bridged through
// FlatCompat. Everything else is native flat config.
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  // Agent tooling checks out scratch worktrees inside the repo directory
  // (.claude/.freebuff/.copilot); their code must never enter this project's lint.
  { ignores: ["node_modules/**", ".next/**", ".next-*/**", ".vitest/**", "out/**", "prisma/migrations/**", "next-env.d.ts", ".claude/**", ".freebuff/**", ".copilot/**"] },
  ...compat.extends("next/core-web-vitals"),
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];

export default config;
