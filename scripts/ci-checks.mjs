import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const git = (...args) => execFileSync("git", ["-c", "core.fsmonitor=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const invoke = (...args) => execFileSync(process.execPath, args, { stdio: "inherit" });
const scopeFile = resolve(process.env.RUNNER_TEMP || "/tmp", "rhodium-ci-scope.json");
const shaPattern = /^[0-9a-f]{40}$/;

/** Resolve the event's actual comparison base; missing history is an error, not an empty selection. */
export function baselineFor(eventName, event, head, defaultTip, bootstrapBase) {
  if (eventName === "pull_request") return { base: event.pull_request.base.sha, mergeBase: true };
  if (eventName === "merge_group") return { base: event.merge_group.base_sha, mergeBase: false };
  if (eventName !== "push") throw new Error(`Unsupported CI event: ${eventName}`);
  if (event.before && !/^0+$/.test(event.before)) return { base: event.before, mergeBase: false };
  // The explicit bootstrap is the audited local main before this repository's
  // first remote publication, not a guessed HEAD parent or an empty diff.
  return defaultTip && defaultTip !== head
    ? { base: defaultTip, mergeBase: true }
    : { base: bootstrapBase, mergeBase: false };
}

/** Select owning checks. Vitest's `related` traverses source imports, including shared dependents. */
export function scopeFor(paths, present = () => true) {
  const sources = paths.filter((path) => /\.(?:[cm]?js|tsx?|json|css)$/.test(path) && /^(?:app|components|lib|tests)\//.test(path));
  const tooling = paths.some((path) => /^(?:package(?:-lock)?\.json|tsconfig\.json|(?:next|postcss|eslint|vitest).*config\.|\.github\/workflows\/|scripts\/ci-checks)/.test(path));
  const seeds = tooling ? ["lib/domain.test.ts", "lib/validation.test.ts", "lib/summary.test.ts", "lib/import-parser.test.ts", "lib/theme.test.ts"] : [];
  const schema = paths.some((path) => path.startsWith("prisma/"));
  const dbSeeds = schema || tooling ? ["tests/integration/budget.test.ts", "tests/integration/reimburse.test.ts", "tests/integration/category-icons.test.ts"] : [];
  return {
    sources: [...new Set([...sources, ...seeds])],
    dbSources: [...new Set([...sources, ...dbSeeds])],
    database: schema || tooling || paths.some((path) => /^(?:app\/api\/|tests\/integration\/|lib\/(?:api|budget|domain|errors|import-parser|ledger-write|prisma|rate-limit|seed|serializers|subscription-planner|subscription-serializer|subscriptions|summary|test-database|transactions|validation)\.)/.test(path)),
    typecheck: tooling || schema || sources.some((path) => /\.tsx?$/.test(path)),
    build: tooling || schema || paths.some((path) => /^(?:app|components)\//.test(path)),
    lint: paths.filter((path) => /\.(?:[cm]?js|tsx?)$/.test(path) && present(path)),
    selectorTests: paths.some((path) => path.startsWith("scripts/ci-checks")),
  };
}

function plan() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const head = git("rev-parse", "HEAD");
  if (process.env.GITHUB_SHA && head !== process.env.GITHUB_SHA) throw new Error("Checkout is not the event candidate");
  let defaultTip;
  try { defaultTip = git("rev-parse", "--verify", "refs/remotes/origin/main"); } catch { /* Empty repository bootstrap. */ }
  const requested = baselineFor(process.env.GITHUB_EVENT_NAME, event, head, defaultTip, process.env.CI_BOOTSTRAP_BASE);
  if (!shaPattern.test(requested.base || "")) throw new Error("Missing or invalid comparison base; repair checkout history or supply its audited bootstrap SHA");
  // checkout fetch-depth: 0 supplies the graph. An unavailable base fails here
  // with its exact revision so callers can repair history rather than pass green.
  git("cat-file", "-e", `${requested.base}^{commit}`);
  if (!requested.mergeBase && (!event.before || /^0+$/.test(event.before))) git("merge-base", "--is-ancestor", requested.base, head);
  const base = requested.mergeBase ? git("merge-base", requested.base, head) : git("rev-parse", requested.base);
  if (base === head) throw new Error("Comparison baseline unexpectedly equals the candidate");
  const paths = git("diff", "--name-only", "--no-renames", "-z", base, head).split("\0").filter(Boolean);
  const scope = { base, head, paths, ...scopeFor(paths, existsSync) };
  writeFileSync(scopeFile, JSON.stringify(scope, null, 2));
  console.log(JSON.stringify(scope, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `build=${scope.build}\nlicensed=${scope.build || scope.typecheck}\n`);
}

function verify() {
  const scope = JSON.parse(readFileSync(scopeFile, "utf8"));
  if (git("rev-parse", "HEAD") !== scope.head) throw new Error("Candidate changed since selection");
  git("diff", "--check", scope.base, scope.head);
  if (scope.selectorTests) invoke("--test", "scripts/ci-checks.test.mjs");
  if (scope.lint.length) invoke("node_modules/eslint/bin/eslint.js", ...scope.lint, "--max-warnings", "0");
  if (scope.typecheck) invoke("node_modules/typescript/bin/tsc", "--noEmit");
  if (scope.sources.length) invoke("node_modules/vitest/vitest.mjs", "related", "--run", "--passWithNoTests", ...scope.sources);
  if (scope.database) {
    invoke("node_modules/prisma/build/index.js", "migrate", "deploy");
    invoke("node_modules/vitest/vitest.mjs", "related", "--run", "--config", "vitest.integration.config.ts", "--passWithNoTests", ...scope.dbSources);
  }
  if (scope.build) execFileSync("npm", ["run", "build"], { stdio: "inherit" });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "plan") plan();
  else if (process.argv[2] === "run") verify();
  else throw new Error("Expected plan or run");
}
