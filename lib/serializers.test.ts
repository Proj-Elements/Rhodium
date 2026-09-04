import { describe, expect, it } from "vitest";
import { serializeCategory, serializeSettlement, serializeTransaction, transactionInclude } from "@/lib/serializers";
import { serializeSubscription, subscriptionInclude } from "@/lib/subscription-serializer";
import type { Category, Transaction } from "@prisma/client";

const category: Category = {
  id: "cat_1",
  name: "餐饮",
  type: "EXPENSE",
  isSystem: false,
  sortOrder: 3,
  archivedAt: null,
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-02T00:00:00.000Z"),
};

const transaction: Transaction & { category: Category; subscription: { name: string } | null } = {
  id: "txn_1",
  type: "EXPENSE",
  amountCents: 1234,
  occurredOn: new Date("2024-03-10T00:00:00.000Z"),
  categoryId: category.id,
  note: "午饭",
  source: "MANUAL",
  subscriptionId: null,
  subscriptionMonth: null,
  subscriptionOccurrenceKey: null,
  deletedAt: new Date("2024-03-11T00:00:00.000Z"),
  createdAt: new Date("2024-03-10T01:00:00.000Z"),
  updatedAt: new Date("2024-03-10T02:00:00.000Z"),
  category,
  subscription: null,
};

describe("serializeTransaction", () => {
  it("maps a manual transaction onto the DTO", () => {
    expect(serializeTransaction(transaction)).toEqual({
      id: "txn_1",
      type: "EXPENSE",
      amountCents: 1234,
      occurredOn: "2024-03-10",
      category: serializeCategory(category),
      note: "午饭",
      source: "MANUAL",
      subscriptionId: null,
      subscriptionMonth: null,
      subscription: null,
    });
  });

  it("never leaks internal columns to the client", () => {
    const dto = serializeTransaction(transaction) as Record<string, unknown>;
    for (const field of ["deletedAt", "createdAt", "updatedAt", "subscriptionOccurrenceKey", "categoryId"]) {
      expect(dto).not.toHaveProperty(field);
    }
  });

  it("keeps the subscription name and month for generated rows", () => {
    const dto = serializeTransaction({
      ...transaction,
      source: "SUBSCRIPTION",
      subscriptionId: "sub_1",
      subscriptionMonth: new Date("2024-03-01T00:00:00.000Z"),
      subscription: { name: "视频会员" },
    });
    expect(dto.subscriptionMonth).toBe("2024-03-01");
    expect(dto.subscription).toEqual({ name: "视频会员" });
  });
});

describe("serializeCategory", () => {
  it("omits timestamps and reports a null archivedAt", () => {
    expect(serializeCategory(category)).toEqual({
      id: "cat_1",
      name: "餐饮",
      type: "EXPENSE",
      isSystem: false,
      sortOrder: 3,
      archivedAt: null,
    });
  });

  it("serializes archivedAt as a full ISO timestamp, not a UTC date", () => {
    // A Shanghai-evening archive lands on the previous UTC day; truncating to a
    // date key would show the wrong day, so the full instant is preserved.
    const archivedAt = new Date("2024-03-10T16:30:00.000Z");
    expect(serializeCategory({ ...category, archivedAt }).archivedAt).toBe("2024-03-10T16:30:00.000Z");
  });
});

describe("serializeSettlement", () => {
  it("reduces the month to a date key and keeps timestamps in full", () => {
    expect(
      serializeSettlement({
        id: "set_1",
        month: new Date("2024-03-01T00:00:00.000Z"),
        budgetAmountCents: 300_000,
        expenseAmountCents: 120_000,
        incomeAmountCents: 10_000,
        remainingAmountCents: 180_000,
        settledAt: new Date("2024-04-01T10:00:00.000Z"),
        reopenedAt: null,
      }),
    ).toEqual({
      id: "set_1",
      month: "2024-03-01",
      budgetAmountCents: 300_000,
      expenseAmountCents: 120_000,
      incomeAmountCents: 10_000,
      remainingAmountCents: 180_000,
      settledAt: "2024-04-01T10:00:00.000Z",
      reopenedAt: null,
    });
  });

  it("passes a reopened settlement through", () => {
    const dto = serializeSettlement({
      id: "set_1",
      month: new Date("2024-03-01T00:00:00.000Z"),
      budgetAmountCents: 0,
      expenseAmountCents: 0,
      incomeAmountCents: 0,
      remainingAmountCents: null,
      settledAt: new Date("2024-04-01T10:00:00.000Z"),
      reopenedAt: new Date("2024-04-02T10:00:00.000Z"),
    });
    expect(dto.reopenedAt).toBe("2024-04-02T10:00:00.000Z");
    expect(dto.remainingAmountCents).toBeNull();
  });
});

describe("serializeSubscription", () => {
  const subscription = {
    id: "sub_1",
    name: "视频会员",
    amountCents: 2500,
    billingDay: 8,
    categoryId: category.id,
    startMonth: new Date("2024-03-01T00:00:00.000Z"),
    endMonth: null as Date | null,
    active: true,
    note: null as string | null,
    category,
  };

  it("reduces months to YYYY-MM", () => {
    expect(serializeSubscription(subscription)).toMatchObject({ startMonth: "2024-03", endMonth: null });
  });

  it("serializes an end month when present", () => {
    const dto = serializeSubscription({ ...subscription, endMonth: new Date("2024-12-01T00:00:00.000Z") });
    expect(dto.endMonth).toBe("2024-12");
  });
});

describe("shared include shapes", () => {
  it("requests exactly the relations the DTOs need", () => {
    expect(transactionInclude).toEqual({ category: true, subscription: { select: { name: true } } });
    expect(subscriptionInclude).toEqual({ category: true });
  });
});
