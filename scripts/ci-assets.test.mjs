import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateFont, validateApiDocs } from "./ci-assets.mjs";

test("font validation rejects HTML downloads and truncated real fonts", () => {
  assert.throws(() => validateFont(Buffer.from("<html>download failed</html>"), "invalid.ttf"), /header/);
  const font = readFileSync(new URL("../public/fonts/dm-sans-regular.ttf", import.meta.url));
  assert.doesNotThrow(() => validateFont(font, "regular.ttf"));
  assert.throws(() => validateFont(font.subarray(0, 100), "truncated.ttf"), /Truncated|Invalid/);
});

test("public API docs reject missing, renamed and obsolete routes", () => {
  const document = "## 5. API 速查表\n| GET /api/health | health |\n## 6. 数据结构";
  const routes = [{ path: "/api/health", source: "export async function GET() {}" }];
  assert.doesNotThrow(() => validateApiDocs(document, routes));
  assert.throws(() => validateApiDocs(document, [...routes, { path: "/api/new", source: "export function POST() {}" }]), /Undocumented/);
  assert.throws(() => validateApiDocs(document.replace("/api/health", "/api/old"), routes), /Undocumented/);
  assert.throws(() => validateApiDocs(document, []), /Unknown documented/);
});

test("public API docs must expose retry, version and history paging requirements", () => {
  const cases = [
    ["POST", "/api/subscriptions", "Idempotency-Key"],
    ["PATCH", "/api/categories/{id}", "expectedVersion"],
    ["GET", "/api/settlements/{month}/history", "limit cursor nextCursor"],
  ];
  for (const [method, path, contract] of cases) {
    const route = [{ path, source: `export async function ${method}() {}` }];
    const document = `## 5. API 速查表\n| ${method} ${path} | ${contract} |\n## 6. 数据结构`;
    assert.doesNotThrow(() => validateApiDocs(document, route));
    assert.throws(() => validateApiDocs(document.replace(contract, "missing"), route), /Missing/);
  }
});
