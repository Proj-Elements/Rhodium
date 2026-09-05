import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseDateOnly } from "@/lib/domain";
import { resetSubscriptionSyncCache, syncSubscriptions } from "@/lib/subscriptions";
import { createCategory, prisma, resetDatabase } from "./helpers";

const REFERENCE = "2024-03-10";

async function addSubscription(name: string, categoryId: string, amountCents = 1_000) {
  return prisma.subscription.create({
    data: { name, categoryId, amountCents, billingDay: 5, startMonth: parseDateOnly("2024-01-01") },
  });
}

beforeEach(async () => {
  await resetDatabase();
  vi.restoreAllMocks();
});

describe("syncSubscriptions", () => {
  it("creates one occurrence per due month and stays idempotent", async () => {
    const category = await createCategory();
    await addSubscription("网盘", category.id);

    const first = await syncSubscriptions(REFERENCE);
    expect(first).toEqual({ created: 3, syncedThrough: REFERENCE });

    resetSubscriptionSyncCache();
    const second = await syncSubscriptions(REFERENCE);
    expect(second.created).toBe(0);
    expect(await prisma.transaction.count()).toBe(3);
  });

  it("reuses the cached result inside the cooldown window", async () => {
    const category = await createCategory();
    await addSubscription("网盘", category.id);
    await syncSubscriptions(REFERENCE);

    await addSubscription("音乐", category.id);
    const cached = await syncSubscriptions(REFERENCE);

    expect(cached.created).toBe(3);
    expect(await prisma.transaction.count()).toBe(3);

    resetSubscriptionSyncCache();
    const afterReset = await syncSubscriptions(REFERENCE);
    expect(afterReset.created).toBe(3);
    expect(await prisma.transaction.count()).toBe(6);
  });

  it("shares one in-flight run between concurrent callers", async () => {
    const category = await createCategory();
    await addSubscription("网盘", category.id);

    const [a, b] = await Promise.all([syncSubscriptions(REFERENCE), syncSubscriptions(REFERENCE)]);

    expect(a).toBe(b);
    expect(await prisma.transaction.count()).toBe(3);
  });

  it("does not cache a failed run", async () => {
    const category = await createCategory();
    await addSubscription("网盘", category.id);

    const spy = vi.spyOn(prisma.subscription, "findMany").mockRejectedValueOnce(new Error("db down"));
    await expect(syncSubscriptions(REFERENCE)).rejects.toThrow("db down");
    spy.mockRestore();

    const retried = await syncSubscriptions(REFERENCE);
    expect(retried.created).toBe(3);
    expect(await prisma.transaction.count()).toBe(3);
  });
});
