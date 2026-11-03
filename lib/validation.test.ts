import { describe, expect, it } from "vitest";
import {
  backupSchema,
  categoryPatchSchema,
  categorySchema,
  importSchema,
  subscriptionSchema,
  subscriptionToggleSchema,
  transactionRestoreSchema,
  transactionSchema,
} from "@/lib/validation";

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

const validTransaction = {
  type: "expense" as const,
  amount: "12.34",
  occurredOn: "2024-03-10",
  categoryId: "cat_1",
};

const validSubscription = {
  name: "视频会员",
  amount: "25",
  billingDay: 8,
  categoryId: "cat_1",
  startMonth: "2024-03",
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

describe("transactionSchema", () => {
  it("accepts a minimal valid body", () => {
    expect(transactionSchema.parse(validTransaction)).toMatchObject({ type: "expense", amount: "12.34" });
  });

  it("accepts numeric amounts as well as strings", () => {
    expect(transactionSchema.parse({ ...validTransaction, amount: 12.34 }).amount).toBe(12.34);
  });

  it.each(["-1", "abc", "", "   "])("rejects amount %j", (amount) => {
    expect(transactionSchema.safeParse({ ...validTransaction, amount }).success).toBe(false);
  });

  it("rejects an amount beyond the recordable ceiling", () => {
    expect(transactionSchema.safeParse({ ...validTransaction, amount: "20000000.01" }).success).toBe(false);
  });

  it("accepts sub-cent input because the domain parser rounds it", () => {
    expect(transactionSchema.safeParse({ ...validTransaction, amount: "1.234" }).success).toBe(true);
  });

  it.each(["2024-3-10", "2024/03/10", "20240310", "2024-03-10T00:00:00Z"])("rejects date format %j", (occurredOn) => {
    expect(transactionSchema.safeParse({ ...validTransaction, occurredOn }).success).toBe(false);
  });

  it.each(["2025-02-31", "2024-02-30", "2024-13-01", "2024-04-31"])("rejects impossible date %j", (occurredOn) => {
    expect(transactionSchema.safeParse({ ...validTransaction, occurredOn }).success).toBe(false);
  });

  it("accepts a leap day in a leap year", () => {
    expect(transactionSchema.safeParse({ ...validTransaction, occurredOn: "2024-02-29" }).success).toBe(true);
  });

  it("rejects a leap day in a common year", () => {
    expect(transactionSchema.safeParse({ ...validTransaction, occurredOn: "2023-02-29" }).success).toBe(false);
  });

  it("rejects an empty categoryId", () => {
    expect(transactionSchema.safeParse({ ...validTransaction, categoryId: "" }).success).toBe(false);
  });

  it("caps the note length at 200 characters", () => {
    expect(transactionSchema.safeParse({ ...validTransaction, note: "字".repeat(200) }).success).toBe(true);
    expect(transactionSchema.safeParse({ ...validTransaction, note: "字".repeat(201) }).success).toBe(false);
  });
});

describe("subscriptionSchema", () => {
  it("defaults active to true", () => {
    expect(subscriptionSchema.parse(validSubscription).active).toBe(true);
  });

  it("trims the name and rejects a blank one", () => {
    expect(subscriptionSchema.parse({ ...validSubscription, name: "  会员  " }).name).toBe("会员");
    expect(subscriptionSchema.safeParse({ ...validSubscription, name: "   " }).success).toBe(false);
  });

  it.each([0, 32, 1.5])("rejects billingDay %j", (billingDay) => {
    expect(subscriptionSchema.safeParse({ ...validSubscription, billingDay }).success).toBe(false);
  });

  it.each([1, 31])("accepts billingDay %j", (billingDay) => {
    expect(subscriptionSchema.safeParse({ ...validSubscription, billingDay }).success).toBe(true);
  });

  it.each(["2024-3", "2024-00", "2024-13", "2024"])("rejects month %j", (startMonth) => {
    expect(subscriptionSchema.safeParse({ ...validSubscription, startMonth }).success).toBe(false);
  });

  it("rejects an endMonth before startMonth and reports it on that field", () => {
    const result = subscriptionSchema.safeParse({ ...validSubscription, endMonth: "2024-02" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["endMonth"]);
      expect(result.error.issues[0]?.message).toBe("结束月份不能早于开始月份");
    }
  });

  it("accepts an endMonth equal to startMonth, and a null one", () => {
    expect(subscriptionSchema.safeParse({ ...validSubscription, endMonth: "2024-03" }).success).toBe(true);
    expect(subscriptionSchema.safeParse({ ...validSubscription, endMonth: null }).success).toBe(true);
  });
});

describe("strict toggle and restore bodies", () => {
  it("accepts an exact toggle body and rejects extra keys", () => {
    expect(subscriptionToggleSchema.safeParse({ active: false }).success).toBe(true);
    expect(subscriptionToggleSchema.safeParse({ active: false, name: "x" }).success).toBe(false);
  });

  it("accepts only restore: true", () => {
    expect(transactionRestoreSchema.safeParse({ restore: true }).success).toBe(true);
    expect(transactionRestoreSchema.safeParse({ restore: false }).success).toBe(false);
    expect(transactionRestoreSchema.safeParse({ restore: true, amount: "1" }).success).toBe(false);
  });

  it("does not mistake a full transaction body for a restore body", () => {
    expect(transactionRestoreSchema.safeParse(validTransaction).success).toBe(false);
  });

  it("does not mistake a full subscription body for a toggle body", () => {
    expect(subscriptionToggleSchema.safeParse({ ...validSubscription, active: true }).success).toBe(false);
  });
});

describe("category schemas", () => {
  it("defaults the type to expense and trims the name", () => {
    expect(categorySchema.parse({ name: "  餐饮  " })).toEqual({ name: "餐饮", type: "expense" });
  });

  it("caps the name at 30 characters", () => {
    expect(categorySchema.safeParse({ name: "字".repeat(31) }).success).toBe(false);
  });

  it("requires at least one field on patch and rejects unknown ones", () => {
    expect(categoryPatchSchema.safeParse({}).success).toBe(false);
    expect(categoryPatchSchema.safeParse({ archived: true }).success).toBe(true);
    expect(categoryPatchSchema.safeParse({ sortOrder: 2 }).success).toBe(false);
  });

  it("preserves a chosen icon on create, patch and backup restore", () => {
    expect(categorySchema.parse({ name: "咖啡时间", icon: "coffee" })).toMatchObject({ icon: "coffee" });
    expect(categoryPatchSchema.parse({ icon: "coffee" })).toEqual({ icon: "coffee" });
    expect(backupSchema.parse({ categories: [{ id: "c1", name: "咖啡时间", icon: "coffee" }] }).categories?.[0].icon).toBe("coffee");
  });

  it("allows automatic icons and legacy backups without an icon", () => {
    expect(categorySchema.parse({ name: "自动分类", icon: null })).toHaveProperty("icon", null);
    expect(categoryPatchSchema.parse({ icon: null })).toEqual({ icon: null });
    expect(backupSchema.parse(exportedBackup).categories?.[0]).not.toHaveProperty("icon");
  });

  it.each(["missing-icon", "https://example.com/icon.svg", "<svg />", "", 42])("rejects unsupported icon %j", (icon) => {
    expect(categorySchema.safeParse({ name: "分类", icon }).success).toBe(false);
    expect(categoryPatchSchema.safeParse({ icon }).success).toBe(false);
    expect(backupSchema.safeParse({ categories: [{ id: "c1", name: "分类", icon }] }).success).toBe(false);
  });
});

describe("importSchema", () => {
  it("allows an empty row list (backup-only restore), caps the batch at 20000, and rejects unknown formats", () => {
    const row = { date: "2024-03-01" };
    expect(importSchema.safeParse({ format: "csv", rows: [] }).success).toBe(true);
    expect(importSchema.safeParse({ format: "csv", rows: [row] }).success).toBe(true);
    expect(importSchema.safeParse({ format: "csv", rows: Array(20_000).fill(row) }).success).toBe(true);
    expect(importSchema.safeParse({ format: "csv", rows: Array(20_001).fill(row) }).success).toBe(false);
    expect(importSchema.safeParse({ format: "xlsx", rows: [{}] }).success).toBe(false);
  });

  it("leaves free-form rows untouched and reports no nested backup by default", () => {
    expect(importSchema.parse({ format: "csv", rows: [{ 日期: "2025-09-01" }] }).backup).toBeUndefined();
  });

  it("validates the nested backup envelope", () => {
    expect(() => importSchema.parse({ format: "json", rows: [{}], backup: { categories: [{ name: "无 id" }] } })).toThrow();
    expect(importSchema.parse({ format: "json", rows: [{}], backup: exportedBackup }).backup?.version).toBe(1);
  });
});
