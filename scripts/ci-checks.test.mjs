import { test } from "node:test";
import assert from "node:assert/strict";
import { baselineFor, databaseTestArgs, dependencyClosure, scopeFor } from "./ci-checks.mjs";

test("existing pushes compare against before, not a guessed parent", () => {
  assert.deepEqual(baselineFor("push", { before: "old" }, "head", "main"), { base: "old", mergeBase: false });
});
test("new branches use main; initial publication uses its audited bootstrap", () => {
  assert.deepEqual(baselineFor("push", { before: "0".repeat(40) }, "head", "main"), { base: "main", mergeBase: true });
  assert.deepEqual(baselineFor("push", {}, "head", "head", "audited-base"), { base: "audited-base", mergeBase: false });
  assert.equal(baselineFor("push", {}, "head", "head").base, undefined);
});
test("PR retargeting and merge queues use their supplied target bases", () => {
  assert.deepEqual(baselineFor("pull_request", { pull_request: { base: { sha: "new-base" } } }, "head"), { base: "new-base", mergeBase: true });
  assert.deepEqual(baselineFor("merge_group", { merge_group: { base_sha: "queue-base" } }, "head"), { base: "queue-base", mergeBase: false });
});
test("docs alone do not invent application checks", () => {
  const scope = scopeFor(["README.md"]);
  assert.equal(scope.build, false);
  assert.equal(scope.database, false);
  assert.deepEqual(scope.sources, []);
});
test("renames/deletions retain dependency paths without linting missing files", () => {
  const scope = scopeFor(["lib/summary.ts", "lib/summary-new.ts"], (path) => path !== "lib/summary.ts");
  assert.equal(scope.database, true);
  assert.ok(scope.sources.includes("lib/summary.ts"));
  assert.deepEqual(scope.lint, ["lib/summary-new.ts"]);
});
test("UI-only work gets its source-related tests and build, not unrelated database suites", () => {
  const scope = scopeFor(["app/transactions/page.tsx", "components/reimburse-dialog.tsx"]);
  assert.equal(scope.build, true);
  assert.equal(scope.typecheck, true);
  assert.equal(scope.database, false);
});
test("schema and tooling changes select explicit accounting contracts", () => {
  const schema = scopeFor(["prisma/schema.prisma"]);
  assert.equal(schema.database, true);
  assert.ok(schema.dbSources.includes("tests/integration/reimburse.test.ts"));
  const tooling = scopeFor(["package-lock.json"]);
  assert.equal(tooling.build, true);
  assert.ok(tooling.sources.includes("lib/summary.test.ts"));
  assert.ok(!tooling.sources.includes("lib/csv.test.ts"));
});
test("schema and migration changes validate the complete owning database suite without expanding unit checks", () => {
  for (const path of ["prisma/schema.prisma", "prisma/migrations/20261111010000_ledger_history/migration.sql", "prisma/migrations/20261111010000_subscription_billing_history/migration.sql"]) {
    const scope = scopeFor([path]);
    assert.equal(scope.database, true, path);
    assert.equal(scope.databaseScope, "all", path);
    assert.deepEqual(databaseTestArgs(scope), ["run", "--config", "vitest.integration.config.ts"], path);
    assert.deepEqual(scope.sources, [], path);
    assert.equal(scope.licensed, false, path);
  }
  const ordinary = scopeFor(["app/api/budgets/[month]/route.ts"]);
  assert.equal(ordinary.databaseScope, "related");
  assert.deepEqual(databaseTestArgs(ordinary), ["related", "--run", "--config", "vitest.integration.config.ts", "--passWithNoTests", "app/api/budgets/[month]/route.ts"]);
});
test("shared ledger locks and destructive-test guards require their database dependents", () => {
  for (const path of ["lib/ledger-write.ts", "lib/test-database.ts"]) {
    const scope = scopeFor([path]);
    assert.equal(scope.database, true, path);
    assert.ok(scope.dbSources.includes(path));
  }
});
test("every container input selects the container smoke test", () => {
  for (const path of ["Dockerfile", ".dockerignore", "docker-compose.yml", "Docker/docker-compose.yml", "scripts/container-entrypoint.mjs"]) {
    const scope = scopeFor([path]);
    assert.equal(scope.container, true, path);
    assert.equal(scope.build, true, path);
    assert.equal(scope.database, true, path);
  }
  assert.equal(scopeFor(["README.md"]).container, false);
});
test("backend-only changes and generated Prisma types need no licensed UI", () => {
  for (const path of ["app/api/transactions/route.ts", "lib/budget.ts", "prisma/schema.prisma", "tsconfig.server.json", "vitest.config.ts", "middleware.ts"]) {
    const scope = scopeFor([path]);
    assert.equal(scope.typecheck, true, path);
    assert.equal(scope.licensed, false, path);
    assert.equal(scope.build, false, path);
  }
});
test("runtime scripts select their existing owning tests", () => {
  const scope = scopeFor(["scripts/container-entrypoint.mjs", "scripts/no-test.mjs"], (path) => path !== "scripts/no-test.test.mjs");
  assert.deepEqual(scope.scriptTests, ["scripts/container-entrypoint.test.mjs"]);
});
test("UI assets and the license channel retain build verification", () => {
  for (const path of ["app/icon.svg", "public/logo.png", "scripts/ci-licensed.mjs", ".github/workflows/ci.yml"]) assert.equal(scopeFor([path]).licensed, true, path);
  assert.equal(scopeFor(["public/skill/SKILL.md"]).licensed, false);
});
test("shared dependencies require their consumers' checks even when deleted", () => {
  const dependencies = { frontend: new Set(["lib/shared.ts"]), database: new Set(["lib/server-helper.ts"]) };
  assert.equal(scopeFor(["lib/shared.ts"], () => false, dependencies).licensed, true);
  assert.equal(scopeFor(["lib/server-helper.ts"], () => false, dependencies).database, true);
});
test("local dependency closure follows aliases, relative imports, re-exports and cycles", () => {
  const contents = {
    "app/page.tsx": 'import type { Data } from "@/lib/types"; import("../lib/shared");',
    "lib/types.ts": 'export type { Data } from "./shared";',
    "lib/shared.ts": 'import "./types"; import "@heroui-pro/react";',
  };
  assert.deepEqual([...dependencyClosure(["app/page.tsx"], Object.keys(contents), (path) => contents[path])].sort(), Object.keys(contents).sort());
});
