export const TEST_DATABASE_MARKER = "rhodium:test-database";

export type TestDatabaseTarget = { url: string; database: string; user: string };
export type TestDatabaseIdentity = { database: string; user: string; schema: string | null; marker: string | null };

/**
 * Require an explicitly named, loopback-only disposable PostgreSQL database.
 * No fallback to DATABASE_URL is permitted. Connection overrides are rejected
 * so URL inspection cannot approve one target while the driver reaches another.
 * Error messages deliberately omit the supplied URL and its credentials.
 */
export function requireTestDatabase(env: Record<string, string | undefined>): TestDatabaseTarget {
  const raw = env.TEST_DATABASE_URL;
  const reject = () => new Error("TEST_DATABASE_URL 必须显式指向本机 PostgreSQL 测试库（库名以 _test 或 _test_<标识> 结尾，schema=public）");
  if (!raw) throw reject();
  let url: URL;
  let database: string;
  let user: string;
  try {
    url = new URL(raw);
    database = decodeURIComponent(url.pathname.slice(1));
    user = decodeURIComponent(url.username);
  } catch {
    throw reject();
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !/^[a-z][a-z0-9_]*_test(?:_[a-z0-9]+)*$/.test(database) ||
    !user || url.hash ||
    [...url.searchParams].some(([key, value]) => key !== "schema" || value !== "public") ||
    url.searchParams.getAll("schema").length > 1
  ) throw reject();
  return { url: raw, database, user };
}

/** Check the actual connection, not just its configured URL, before destructive SQL. */
export function assertTestDatabaseIdentity(target: TestDatabaseTarget, actual: TestDatabaseIdentity | undefined): void {
  if (!actual || actual.database !== target.database || actual.user !== target.user || actual.schema !== "public" || actual.marker !== TEST_DATABASE_MARKER) {
    throw new Error("拒绝清空数据库：实际数据库、用户、schema 或 rhodium:test-database 标记不符合显式测试目标");
  }
}
