import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createSubscription } from "@/app/api/subscriptions/route";
import { POST as reopenMonth } from "@/app/api/settlements/[month]/reopen/route";
import { monthStart, parseDateOnly, todayInShanghai } from "@/lib/domain";
import { resetSubscriptionSyncCache, syncSubscriptions } from "@/lib/subscriptions";
import { initialBillingHistory } from "@/lib/billing-history";
import { createCategory, prisma, resetDatabase, routeContext } from "./helpers";

const REFERENCE = "2024-03-10";

async function addSubscription(name: string, categoryId: string, amountCents = 1_000) {
  return prisma.subscription.create({
    data: {
      name, categoryId, amountCents, billingDay: 5, startMonth: parseDateOnly("2024-01-01"),
      billingHistory: initialBillingHistory({ name, categoryId, amountCents, billingDay: 5, startMonth: "2024-01", endMonth: null, note: null }),
    },
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
    expect(first).toEqual({ created: 3, syncedThrough: REFERENCE, skippedUnknownHistory: 0, historyWarnings: [] });

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

    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("db down"));
    await expect(syncSubscriptions(REFERENCE)).rejects.toThrow("db down");
    spy.mockRestore();

    const retried = await syncSubscriptions(REFERENCE);
    expect(retried.created).toBe(3);
    expect(await prisma.transaction.count()).toBe(3);
  });

  it("stops planning occurrences once the subscription's category is archived", async () => {
    const category = await createCategory();
    await addSubscription("网盘", category.id);
    await prisma.category.update({ where: { id: category.id }, data: { archivedAt: new Date("2024-01-10T00:00:00.000Z") } });

    expect((await syncSubscriptions(REFERENCE)).created).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
  });
});

/**
 * Route writes must not let the cooldown cache answer the route's own sync
 * call: the app chrome syncs on every page load, so without invalidation a
 * create/toggle/reopen would silently defer its backfill for up to 60 seconds.
 */
describe("route writes invalidate the sync cache", () => {
  it("materialises a subscription created inside the cooldown window", async () => {
    const category = await createCategory();
    // Prime the cache with the real reference date: every later call in the
    // 60s window would otherwise reuse this empty run.
    await syncSubscriptions();

    const response = await createSubscription(
      new Request("http://localhost/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "网盘",
          amount: "10",
          billingDay: 1,
          categoryId: category.id,
          startMonth: todayInShanghai().slice(0, 7),
        }),
      }),
    );
    expect(response.status).toBe(201);

    const created = await prisma.transaction.count({ where: { source: "SUBSCRIPTION" } });
    expect(created).toBe(1);
  });

  it("plans again after a month is reopened (occurrences were skipped while locked)", async () => {
    const category = await createCategory();
    const month = todayInShanghai().slice(0, 7);
    await prisma.subscription.create({
      data: {
        name: "云盘", categoryId: category.id, amountCents: 1_000, billingDay: 1, startMonth: monthStart(month),
        billingHistory: initialBillingHistory({ name: "云盘", categoryId: category.id, amountCents: 1_000, billingDay: 1, startMonth: month, endMonth: null, note: null }),
      },
    });
    await prisma.monthlySettlement.create({
      data: { month: monthStart(month), budgetAmountCents: 0, expenseAmountCents: 0, incomeAmountCents: 0, remainingAmountCents: null },
    });
    expect((await syncSubscriptions()).created).toBe(0);

    const response = await reopenMonth(new Request("http://localhost/api/settlements/reopen", { method: "POST" }), routeContext({ month }));
    expect(response.status).toBe(200);

    expect((await syncSubscriptions()).created).toBe(1);
  });
});
