import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validateFont(bytes, name) {
  if (bytes.length < 12 || ![0x00010000, 0x4f54544f].includes(bytes.readUInt32BE(0))) throw new Error(`Invalid font header: ${name}`);
  const count = bytes.readUInt16BE(4);
  if (!count || bytes.length < 12 + count * 16) throw new Error(`Truncated font directory: ${name}`);
  const tables = new Set();
  for (let index = 0; index < count; index += 1) {
    const entry = 12 + index * 16;
    const tag = bytes.toString("ascii", entry, entry + 4);
    const offset = bytes.readUInt32BE(entry + 8);
    const size = bytes.readUInt32BE(entry + 12);
    if (tables.has(tag) || offset > bytes.length || size > bytes.length - offset) throw new Error(`Invalid font table: ${name}/${tag}`);
    tables.add(tag);
  }
  for (const tag of ["head", "cmap", "name", "maxp"]) if (!tables.has(tag)) throw new Error(`Missing font table: ${name}/${tag}`);
}

export function documentedRoutes(markdown) {
  const section = markdown.split("## 5. API 速查表")[1]?.split("## 6.")[0];
  if (!section) throw new Error("Missing public API route table");
  const result = new Map();
  for (const line of section.split("\n")) {
    const match = /^\|\s+((?:GET|POST|PUT|PATCH|DELETE)(?:\/(?:GET|POST|PUT|PATCH|DELETE))*)\s+(\/api\/[^\s?|]+)/.exec(line);
    if (match) for (const method of match[1].split("/")) result.set(`${method} ${match[2]}`, line);
  }
  return result;
}

export function validateApiDocs(markdown, routes) {
  const documented = documentedRoutes(markdown);
  const actual = new Set(routes.flatMap(({ path, source }) => [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => `${match[1]} ${path}`)));
  for (const key of actual) if (!documented.has(key)) throw new Error(`Undocumented API: ${key}`);
  for (const key of documented.keys()) if (!actual.has(key)) throw new Error(`Unknown documented API: ${key}`);
  for (const key of ["PATCH /api/transactions/{id}", "DELETE /api/transactions/{id}", "PATCH /api/subscriptions/{id}", "DELETE /api/subscriptions/{id}", "PATCH /api/categories/{id}", "PUT /api/budgets/{month}", "DELETE /api/budgets/{month}", "PUT /api/budgets/preset", "POST /api/settlements/{month}/reopen"]) {
    if (actual.has(key) && !documented.get(key)?.includes("expectedVersion")) throw new Error(`Missing concurrency contract: ${key}`);
  }
  for (const key of ["POST /api/transactions", "POST /api/subscriptions"]) if (actual.has(key) && !documented.get(key)?.includes("Idempotency-Key")) throw new Error(`Missing retry contract: ${key}`);
  for (const key of actual) if (key.endsWith("/history") && !["limit", "cursor", "nextCursor"].every((field) => documented.get(key)?.includes(field))) throw new Error(`Missing pagination contract: ${key}`);
}

function checkFonts(root) {
  const css = readFileSync(resolve(root, "app/globals.css"), "utf8");
  const referenced = [...css.matchAll(/url\(["']?(\/fonts\/[^"')]+)["']?\)/g)].map((match) => match[1].slice(1));
  if (!referenced.length) throw new Error("No local font references found");
  const fonts = new Set([...referenced, ...readdirSync(resolve(root, "public/fonts")).filter((name) => /\.(?:ttf|otf)$/.test(name)).map((name) => `fonts/${name}`)]);
  for (const font of fonts) validateFont(readFileSync(resolve(root, "public", font)), font);
  console.log(`Validated ${fonts.size} font assets and CSS references`);
}

function checkApi(root) {
  const routes = readdirSync(resolve(root, "app/api"), { recursive: true }).filter((name) => name.endsWith("/route.ts")).map((name) => ({
    path: `/api/${name.slice(0, -"/route.ts".length).replace(/\[([^\]]+)\]/g, "{$1}")}`,
    source: readFileSync(resolve(root, "app/api", name), "utf8"),
  }));
  validateApiDocs(readFileSync(resolve(root, "public/skill/SKILL.md"), "utf8"), routes);
  console.log(`Validated public skill against ${routes.length} route handlers`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "fonts") checkFonts(process.cwd());
  else if (mode === "api") checkApi(process.cwd());
  else throw new Error("Expected fonts or api");
}
