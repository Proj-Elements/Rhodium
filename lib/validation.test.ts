import { describe, expect, it } from "vitest";
import {
  categoryPatchSchema,
  categorySchema,
  subscriptionSchema,
  subscriptionToggleSchema,
  transactionReimburseSchema,
  transactionRestoreSchema,
  transactionSchema,
  transactionEditSchema,
  transactionUnreimburseSchema,
} from "@/lib/validation";

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

describe("transactionSchema", () => {
  it("accepts a minimal valid body", () => {
    expect(transactionSchema.parse(validTransaction)).toMatchObject({ type: "expense", amount: "12.34" });
  });

  it("accepts numeric amounts as well as strings", () => {
    expect(transactionSchema.parse({ ...validTransaction, amount: 12.34 }).amount).toBe(12.34);
  });

  it.each(["-1", "abc", "", "   ", "0x10", "1,2,3", "1e3"])("rejects amount %j", (amount) => {
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

  it.each(["restore", "reimburse", "unreimburse"])("rejects an action %s mixed with a create or edit", (action) => {
    expect(transactionSchema.safeParse({ ...validTransaction, [action]: true }).success).toBe(false);
    expect(transactionEditSchema.safeParse({ ...validTransaction, expectedVersion: 1, [action]: true }).success).toBe(false);
  });

  it("requires an integer version for every full edit", () => {
    expect(transactionEditSchema.safeParse({ ...validTransaction, expectedVersion: 1 }).success).toBe(true);
    for (const expectedVersion of [undefined, 0, -1, 1.5, "1"]) {
      expect(transactionEditSchema.safeParse({ ...validTransaction, expectedVersion }).success).toBe(false);
    }
    expect(transactionSchema.safeParse({ ...validTransaction, expectedVersion: 1 }).success).toBe(false);
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
    expect(transactionRestoreSchema.safeParse({ restore: true, expectedVersion: 1 }).success).toBe(true);
    expect(transactionRestoreSchema.safeParse({ restore: false, expectedVersion: 1 }).success).toBe(false);
    expect(transactionRestoreSchema.safeParse({ restore: true, expectedVersion: 1, amount: "1" }).success).toBe(false);
  });

  it("accepts only reimburse: true and rejects extra keys", () => {
    expect(transactionReimburseSchema.safeParse({ reimburse: true, expectedVersion: 1 }).success).toBe(true);
    expect(transactionReimburseSchema.safeParse({ reimburse: false, expectedVersion: 1 }).success).toBe(false);
    expect(transactionReimburseSchema.safeParse({ reimburse: true, expectedVersion: 1, amount: "1" }).success).toBe(false);
  });

  it("accepts only unreimburse: true and rejects mixed actions or edits", () => {
    expect(transactionUnreimburseSchema.safeParse({ unreimburse: true, expectedVersion: 1 }).success).toBe(true);
    expect(transactionUnreimburseSchema.safeParse({ unreimburse: false, expectedVersion: 1 }).success).toBe(false);
    expect(transactionUnreimburseSchema.safeParse({ unreimburse: true, expectedVersion: 1, amount: "1" }).success).toBe(false);
    expect(transactionUnreimburseSchema.safeParse({ unreimburse: true, expectedVersion: 1, reimburse: true }).success).toBe(false);
    expect(transactionUnreimburseSchema.safeParse(validTransaction).success).toBe(false);
  });

  it("does not mistake a full transaction body for a restore body", () => {
    expect(transactionRestoreSchema.safeParse(validTransaction).success).toBe(false);
  });

  it("does not mistake a full transaction body for a reimburse body", () => {
    expect(transactionReimburseSchema.safeParse(validTransaction).success).toBe(false);
  });

  it("does not mistake a full subscription body for a toggle body", () => {
    expect(subscriptionToggleSchema.safeParse({ ...validSubscription, active: true }).success).toBe(false);
  });

  it.each([transactionRestoreSchema, transactionReimburseSchema, transactionUnreimburseSchema])("requires the observed version for action requests", (schema) => {
    const actions = { restore: true, reimburse: true, unreimburse: true };
    for (const [action, value] of Object.entries(actions)) {
      expect(schema.safeParse({ [action]: value }).success).toBe(false);
      expect(schema.safeParse({ [action]: value, expectedVersion: 0 }).success).toBe(false);
      expect(schema.safeParse({ [action]: value, expectedVersion: 1.5 }).success).toBe(false);
    }
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

  it("preserves a chosen icon on create and patch", () => {
    expect(categorySchema.parse({ name: "咖啡时间", icon: "coffee" })).toMatchObject({ icon: "coffee" });
    expect(categoryPatchSchema.parse({ icon: "coffee" })).toEqual({ icon: "coffee" });
  });

  it("allows automatic icons", () => {
    expect(categorySchema.parse({ name: "自动分类", icon: null })).toHaveProperty("icon", null);
    expect(categoryPatchSchema.parse({ icon: null })).toEqual({ icon: null });
  });

  it.each(["missing-icon", "https://example.com/icon.svg", "<svg />", "", 42])("rejects unsupported icon %j", (icon) => {
    expect(categorySchema.safeParse({ name: "分类", icon }).success).toBe(false);
    expect(categoryPatchSchema.safeParse({ icon }).success).toBe(false);
  });
});
