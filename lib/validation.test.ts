import { describe, expect, it } from "vitest";
import { backupSchema, categoryPatchSchema, importSchema, restoreSchema, subscriptionSchema, transactionSchema } from "@/lib/validation";

/** Shaped exactly like GET /api/export?format=json, extra columns included. */
const exportedBackup = {
  version: 1,
  exportedAt: "2025-09-01T00:00:00.000Z",
  categories: [
    { id: "cat-1", name: "餐饮", type: "EXPENSE", isSystem: true, sortOrder: 0, archivedAt: null, createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" },
  ],
  subscriptions: [
    { id: "sub-1", name: "音乐会员", amountCents: 1500, billingDay: 8, categoryId: "cat-1", startMonth: "2025-01", endMonth: null, active: true, note: null },
  ],
  budgets: [{ id: "bud-1", month: "2025-09-01", amountCents: 300000 }],
  settlements: [
    {
      id: "set-1",
      month: "2025-08-01",
      budgetAmountCents: 300000,
      expenseAmountCents: 120000,
      incomeAmountCents: 0,
      remainingAmountCents: 180000,
      settledAt: "2025-09-01T00:00:00.000Z",
      reopenedAt: null,
    },
  ],
};

describe("backupSchema", () => {
  it("accepts a real export payload", () => {
    const parsed = backupSchema.parse(exportedBackup);
    expect(parsed.categories?.[0].name).toBe("餐饮");
    expect(parsed.subscriptions?.[0].categoryId).toBe("cat-1");
    expect(parsed.budgets?.[0].month).toBe("2025-09-01");
    expect(parsed.settlements?.[0].remainingAmountCents).toBe(180000);
  });

  it("strips columns that must never reach the database", () => {
    const parsed = backupSchema.parse(exportedBackup);
    expect(parsed.categories?.[0]).not.toHaveProperty("createdAt");
    expect(parsed.budgets?.[0]).not.toHaveProperty("id");
    expect(parsed.settlements?.[0]).not.toHaveProperty("id");
  });

  it("rejects rows missing their correlation id or natural key", () => {
    expect(() => backupSchema.parse({ categories: [{ name: "餐饮" }] })).toThrow();
    expect(() => backupSchema.parse({ subscriptions: [{ id: "s1", name: "会员", amountCents: 100, billingDay: 1, startMonth: "2025-01" }] })).toThrow();
    expect(() => backupSchema.parse({ budgets: [{ amountCents: 100 }] })).toThrow();
  });

  it("rejects impossible or malformed months", () => {
    expect(() => backupSchema.parse({ budgets: [{ month: "2025-02-30", amountCents: 100 }] })).toThrow();
    expect(() => backupSchema.parse({ settlements: [{ month: "2025-08", budgetAmountCents: 1, expenseAmountCents: 1, incomeAmountCents: 1 }] })).toThrow();
  });

  it("caps payload size so one request cannot balloon the restore", () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({ id: `c${index}`, name: `分类${index}` }));
    expect(() => backupSchema.parse({ categories: rows })).toThrow();
  });
});

describe("importSchema", () => {
  it("requires at least one row and a known format", () => {
    expect(() => importSchema.parse({ format: "json", rows: [] })).toThrow();
    expect(() => importSchema.parse({ format: "xml", rows: [{}] })).toThrow();
    expect(importSchema.parse({ format: "csv", rows: [{ 日期: "2025-09-01" }] }).backup).toBeUndefined();
  });

  it("validates the nested backup envelope", () => {
    expect(() => importSchema.parse({ format: "json", rows: [{}], backup: { categories: [{ name: "无 id" }] } })).toThrow();
    expect(importSchema.parse({ format: "json", rows: [{}], backup: exportedBackup }).backup?.version).toBe(1);
  });
});

describe("other request schemas", () => {
  it("rejects impossible calendar dates on transactions", () => {
    expect(() => transactionSchema.parse({ type: "expense", amount: "1", occurredOn: "2025-02-30", categoryId: "c1" })).toThrow();
    expect(transactionSchema.parse({ type: "expense", amount: "1", occurredOn: "2025-02-28", categoryId: "c1" }).amount).toBe("1");
  });

  it("rejects a subscription ending before it starts", () => {
    expect(() => subscriptionSchema.parse({ name: "会员", amount: "1", billingDay: 1, categoryId: "c1", startMonth: "2025-05", endMonth: "2025-04" })).toThrow();
  });

  it("requires at least one field on a category patch", () => {
    expect(() => categoryPatchSchema.parse({})).toThrow();
    expect(categoryPatchSchema.parse({ archived: true }).archived).toBe(true);
  });

  it("accepts only a bare restore flag", () => {
    expect(restoreSchema.parse({ restore: true }).restore).toBe(true);
    expect(restoreSchema.safeParse({ restore: false }).success).toBe(false);
    expect(restoreSchema.safeParse({ restore: true, amount: "999" }).success).toBe(false);
    expect(restoreSchema.safeParse({}).success).toBe(false);
  });
});
