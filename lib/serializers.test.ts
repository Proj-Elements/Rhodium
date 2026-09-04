import { describe, expect, it } from "vitest";
import { serializeCategory, serializeSettlement, serializeTransaction } from "@/lib/serializers";
import { serializeSubscription } from "@/lib/subscription-serializer";

/**
 * The serializers are the only boundary between Prisma rows and the JSON the
 * client receives, so these tests assert the *exact* key set: an accidental
 * spread would leak deletedAt / subscriptionOccurrenceKey / timestamps.
 */

const categoryRow = {
  id: "cat_1",
  name: "餐饮",
  type: "EXPENSE" as const,
  isSystem: true,
  sortOrder: 10,
  archivedAt: null,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-02-02T03:04:05.000Z"),
};

describe("serializeCategory", () => {
  it("exposes only the DTO fields", () => {
    expect(serializeCategory(categoryRow)).toEqual({
      id: "cat_1",
      name: "餐饮",
      type: "EXPENSE",
      isSystem: true,
      sortOrder: 10,
      archivedAt: null,
    });
  });

  it("renders archivedAt as a date-only key", () => {
    const archived = serializeCategory({ ...categoryRow, archivedAt: new Date("2025-09-04T15:30:00.000Z") });
    expect(archived.archivedAt).toBe("2025-09-04");
  });
});

describe("serializeTransaction", () => {
  const transactionRow = {
    id: "txn_1",
    type: "EXPENSE" as const,
    amountCents: 1250,
    occurredOn: new Date("2026-09-04T00:00:00.000Z"),
    categoryId: "cat_1",
    category: categoryRow,
    note: "午饭",
    source: "SUBSCRIPTION" as const,
    subscriptionId: "sub_1",
    subscriptionMonth: new Date("2026-09-01T00:00:00.000Z"),
    subscription: { name: "网易云音乐" },
    subscriptionOccurrenceKey: "sub_1:2026-09",
    deletedAt: new Date("2026-09-05T00:00:00.000Z"),
    createdAt: new Date("2026-09-04T01:00:00.000Z"),
    updatedAt: new Date("2026-09-04T02:00:00.000Z"),
  };

  it("whitelists fields and keeps amounts in integer cents", () => {
    expect(serializeTransaction(transactionRow)).toEqual({
      id: "txn_1",
      type: "EXPENSE",
      amountCents: 1250,
      occurredOn: "2026-09-04",
      category: {
        id: "cat_1",
        name: "餐饮",
        type: "EXPENSE",
        isSystem: true,
        sortOrder: 10,
        archivedAt: null,
      },
      note: "午饭",
      source: "SUBSCRIPTION",
      subscriptionId: "sub_1",
      subscriptionMonth: "2026-09-01",
      subscription: { name: "网易云音乐" },
    });
  });

  it("never leaks internal bookkeeping fields", () => {
    const keys = Object.keys(serializeTransaction(transactionRow));
    expect(keys).not.toContain("deletedAt");
    expect(keys).not.toContain("subscriptionOccurrenceKey");
    expect(keys).not.toContain("createdAt");
    expect(keys).not.toContain("updatedAt");
    expect(keys).not.toContain("categoryId");
  });

  it("nulls the optional subscription fields for manual entries", () => {
    const manual = serializeTransaction({
      ...transactionRow,
      source: "MANUAL",
      subscriptionId: null,
      subscriptionMonth: null,
      subscription: null,
      subscriptionOccurrenceKey: null,
    });
    expect(manual.subscriptionId).toBeNull();
    expect(manual.subscriptionMonth).toBeNull();
    expect(manual.subscription).toBeNull();
  });
});

describe("serializeSettlement", () => {
  const settlementRow = {
    id: "stl_1",
    month: new Date("2026-09-01T00:00:00.000Z"),
    budgetAmountCents: 200000,
    expenseAmountCents: 143210,
    incomeAmountCents: 50000,
    remainingAmountCents: 56790,
    settledAt: new Date("2026-10-01T02:03:04.000Z"),
    reopenedAt: null,
  };

  it("maps month to a date key and timestamps to ISO strings", () => {
    expect(serializeSettlement(settlementRow)).toEqual({
      id: "stl_1",
      month: "2026-09-01",
      budgetAmountCents: 200000,
      expenseAmountCents: 143210,
      incomeAmountCents: 50000,
      remainingAmountCents: 56790,
      settledAt: "2026-10-01T02:03:04.000Z",
      reopenedAt: null,
    });
  });

  it("keeps a null remaining amount distinct from zero", () => {
    const noBudget = serializeSettlement({ ...settlementRow, remainingAmountCents: null });
    expect(noBudget.remainingAmountCents).toBeNull();
  });

  it("serializes reopenedAt when the month was reopened", () => {
    const reopened = serializeSettlement({ ...settlementRow, reopenedAt: new Date("2026-10-02T00:00:00.000Z") });
    expect(reopened.reopenedAt).toBe("2026-10-02T00:00:00.000Z");
  });
});

describe("serializeSubscription", () => {
  const subscriptionRow = {
    id: "sub_1",
    name: "网易云音乐",
    amountCents: 800,
    billingDay: 31,
    categoryId: "cat_1",
    startMonth: new Date("2026-09-01T00:00:00.000Z"),
    endMonth: null,
    active: true,
    note: null,
    category: categoryRow,
  };

  it("reduces the month columns to YYYY-MM keys", () => {
    expect(serializeSubscription(subscriptionRow)).toEqual({
      id: "sub_1",
      name: "网易云音乐",
      amountCents: 800,
      billingDay: 31,
      categoryId: "cat_1",
      category: {
        id: "cat_1",
        name: "餐饮",
        type: "EXPENSE",
        isSystem: true,
        sortOrder: 10,
        archivedAt: null,
      },
      startMonth: "2026-09",
      endMonth: null,
      active: true,
      note: null,
    });
  });

  it("serializes endMonth when the subscription is bounded", () => {
    const bounded = serializeSubscription({ ...subscriptionRow, endMonth: new Date("2026-12-01T00:00:00.000Z") });
    expect(bounded.endMonth).toBe("2026-12");
  });
});
