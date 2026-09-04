import { TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { transactionData, transactionType } from "@/lib/transactions";
import { subscriptionData } from "@/lib/subscriptions";
import { getCategoryColor } from "@/lib/category-colors";

describe("transactionType", () => {
  it("maps the client discriminator onto the Prisma enum", () => {
    expect(transactionType("expense")).toBe(TransactionType.EXPENSE);
    expect(transactionType("income")).toBe(TransactionType.INCOME);
  });
});

describe("transactionData", () => {
  const input = {
    type: "expense" as const,
    amount: "12.34",
    occurredOn: "2024-03-10",
    categoryId: "cat_1",
    note: "  午饭  ",
  };

  it("converts money to cents, the date to UTC midnight, and trims the note", () => {
    expect(transactionData(input)).toEqual({
      type: TransactionType.EXPENSE,
      amountCents: 1234,
      occurredOn: new Date("2024-03-10T00:00:00.000Z"),
      categoryId: "cat_1",
      note: "午饭",
    });
  });

  it.each([undefined, null, "", "   "])("normalises note %j to null", (note) => {
    expect(transactionData({ ...input, note }).note).toBeNull();
  });

  it("rounds a sub-cent amount", () => {
    expect(transactionData({ ...input, amount: "1.005" }).amountCents).toBe(101);
  });
});

describe("subscriptionData", () => {
  const input = {
    name: "视频会员",
    amount: "25",
    billingDay: 8,
    categoryId: "cat_1",
    startMonth: "2024-03",
    endMonth: null,
    active: true,
    note: "  年付  ",
  };

  it("expands months to their first day and trims the note", () => {
    expect(subscriptionData(input)).toEqual({
      name: "视频会员",
      amountCents: 2500,
      billingDay: 8,
      categoryId: "cat_1",
      startMonth: new Date("2024-03-01T00:00:00.000Z"),
      endMonth: null,
      active: true,
      note: "年付",
    });
  });

  it("keeps an end month when provided", () => {
    expect(subscriptionData({ ...input, endMonth: "2024-12" }).endMonth).toEqual(new Date("2024-12-01T00:00:00.000Z"));
  });

  it.each([undefined, null, "   "])("normalises note %j to null", (note) => {
    expect(subscriptionData({ ...input, note }).note).toBeNull();
  });
});

describe("getCategoryColor", () => {
  it("is deterministic for the same id", () => {
    expect(getCategoryColor("cat_1")).toEqual(getCategoryColor("cat_1"));
  });

  it("always returns a palette entry with both tokens", () => {
    for (const id of ["a", "cat_1", "餐饮", "", "x".repeat(64)]) {
      const entry = getCategoryColor(id);
      expect(entry.color).toMatch(/^var\(--/);
      expect(entry.surface).toMatch(/^var\(--/);
    }
  });

  it("spreads ids across more than one palette slot", () => {
    const ids = Array.from({ length: 40 }, (_, index) => `cat_${index}`);
    const distinct = new Set(ids.map((id) => getCategoryColor(id).color));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
