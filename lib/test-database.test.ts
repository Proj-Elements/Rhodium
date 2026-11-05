import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const truncate = vi.fn();
  return { query, truncate, transaction: vi.fn(async (callback) => callback({ $queryRaw: query, $executeRawUnsafe: truncate })) };
});

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction, $executeRawUnsafe: mocks.truncate } }));
vi.mock("@/lib/seed", () => ({ resetSeedCache: vi.fn() }));
vi.mock("@/lib/subscriptions", () => ({ resetSubscriptionSyncCache: vi.fn() }));

const SAFE_URL = "postgresql://rhodium_test:example@127.0.0.1:5432/rhodium_quality_test?schema=public";
const identity = { database: "rhodium_quality_test", user: "rhodium_test", schema: "public", marker: "rhodium:test-database" };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("TEST_DATABASE_URL", SAFE_URL);
  vi.stubEnv("DATABASE_URL", SAFE_URL);
  mocks.query.mockResolvedValue([identity]);
  mocks.truncate.mockResolvedValue(0);
});

afterEach(() => vi.unstubAllEnvs());

describe("integration database configuration", () => {
  it("does not fall back to DATABASE_URL", async () => {
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    await expect(import("../vitest.integration.config")).rejects.toThrow(/TEST_DATABASE_URL/);
  });

  it.each([
    "",
    "not-a-url",
    "mysql://user:password@localhost/rhodium_test",
    "postgresql://user:password@localhost/rhodium",
    "postgresql://user:password@db.example.com/rhodium_test",
    "postgresql://user:password@localhost/rhodium_test?schema=production",
    "postgresql://user:password@localhost/rhodium_test?schema=public&schema=production",
    "postgresql://user:password@localhost/rhodium_test?host=production",
  ])("rejects an unsafe target: %s", async (url) => {
    vi.stubEnv("TEST_DATABASE_URL", url);
    await expect(import("../vitest.integration.config")).rejects.toThrow(/TEST_DATABASE_URL/);
  });

  it("overrides the ordinary database URL with the explicitly approved target", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:secret@production/rhodium");
    const { default: config } = await import("../vitest.integration.config");
    expect(config.test?.env).toMatchObject({ DATABASE_URL: SAFE_URL, TEST_DATABASE_URL: SAFE_URL });
  });
});

describe("pre-TRUNCATE guard", () => {
  it("refuses missing explicit opt-in before issuing database commands", async () => {
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    const { resetDatabase } = await import("../tests/integration/helpers");
    await expect(resetDatabase()).rejects.toThrow(/TEST_DATABASE_URL/);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.truncate).not.toHaveBeenCalled();
  });

  it.each([
    { ...identity, database: "rhodium" },
    { ...identity, user: "unexpected" },
    { ...identity, schema: "private" },
    { ...identity, marker: null },
    { ...identity, marker: "production" },
  ])("refuses an actual database identity mismatch: %j", async (actual) => {
    mocks.query.mockResolvedValue([actual]);
    const { resetDatabase } = await import("../tests/integration/helpers");
    await expect(resetDatabase()).rejects.toThrow(/拒绝清空/);
    expect(mocks.truncate).not.toHaveBeenCalled();
  });

  it("refuses a client URL different from the approved target", async () => {
    vi.stubEnv("DATABASE_URL", SAFE_URL.replace("5432", "5433"));
    const { resetDatabase } = await import("../tests/integration/helpers");
    await expect(resetDatabase()).rejects.toThrow(/DATABASE_URL/);
    expect(mocks.truncate).not.toHaveBeenCalled();
  });

  it("does not truncate when identity verification fails", async () => {
    mocks.query.mockRejectedValue(new Error("identity query failed"));
    const { resetDatabase } = await import("../tests/integration/helpers");
    await expect(resetDatabase()).rejects.toThrow("identity query failed");
    expect(mocks.truncate).not.toHaveBeenCalled();
  });

  it("verifies identity and truncates schema-qualified tables on the same connection", async () => {
    const { resetDatabase } = await import("../tests/integration/helpers");
    await resetDatabase();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.truncate).toHaveBeenCalledOnce();
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(mocks.truncate.mock.invocationCallOrder[0]);
    expect(mocks.truncate.mock.calls[0][0]).toContain('TRUNCATE TABLE "public"."Transaction"');
  });
});
