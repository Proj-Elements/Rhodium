import { test } from "node:test";
import assert from "node:assert/strict";
import { databaseUrlFromEnv } from "./container-entrypoint.mjs";

const env = { PGHOST: "db", PGDATABASE: "yueyu", PGUSER: "yueyu", PGPASSWORD: "local-password" };

test("explicit DATABASE_URL remains compatible with existing deployments", () => {
  const explicit = "postgresql://user:pass@127.0.0.1:5432/existing?schema=public";
  assert.equal(databaseUrlFromEnv({ DATABASE_URL: explicit }), explicit);
});

test("raw database credentials survive reserved URL characters exactly", () => {
  const values = { ...env, PGUSER: "user@:#%", PGPASSWORD: "p@ss:/?#%20$'\" 账", PGDATABASE: "ledger/#%" };
  const url = new URL(databaseUrlFromEnv(values));
  assert.equal(decodeURIComponent(url.username), values.PGUSER);
  assert.equal(decodeURIComponent(url.password), values.PGPASSWORD);
  assert.equal(decodeURIComponent(url.pathname.slice(1)), values.PGDATABASE);
  assert.equal(url.hostname, "db");
  assert.equal(url.port, "5432");
  assert.equal(url.searchParams.get("schema"), "public");
});

test("supports IPv6 and explicit schema without changing either identity", () => {
  const url = new URL(databaseUrlFromEnv({ ...env, PGHOST: "::1", PGPORT: "5444", PGSCHEMA: "ledger data" }));
  assert.equal(url.hostname, "[::1]");
  assert.equal(url.port, "5444");
  assert.equal(url.searchParams.get("schema"), "ledger data");
});

test("requires complete configuration without disclosing credentials", () => {
  assert.throws(() => databaseUrlFromEnv({ PGPASSWORD: "secret-value" }), /Set DATABASE_URL or PGHOST/);
  assert.throws(() => databaseUrlFromEnv({ ...env, PGPORT: "5432/other" }), /PGPORT must be a valid port/);
  assert.throws(() => databaseUrlFromEnv({ ...env, PGHOST: "db@evil.example" }), /PGHOST must be a database hostname/);
});
