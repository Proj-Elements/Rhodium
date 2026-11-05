import { test } from "node:test";
import assert from "node:assert/strict";
import { baselineFor, scopeFor } from "./ci-checks.mjs";

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
test("shared ledger locks and destructive-test guards require their database dependents", () => {
  for (const path of ["lib/ledger-write.ts", "lib/test-database.ts"]) {
    const scope = scopeFor([path]);
    assert.equal(scope.database, true, path);
    assert.ok(scope.dbSources.includes(path));
  }
});
