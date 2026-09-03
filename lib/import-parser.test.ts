import { describe, expect, it } from "vitest";
import {
  normalizeRow,
  parseAmountToCents,
  parseBoolean,
  parseCents,
  parseSignedCents,
  parseTransactionType,
  validateRowShallow,
} from "@/lib/import-parser";

describe("import row normalization", () => {
  it("normalizes an English-keyed JSON row", () => {
    const row = normalizeRow({ occurredOn: "2025-09-01", amount: "12.5", type: "expense", category: "餐饮", note: "午饭" });
    expect(row.occurredOn.toISOString()).toBe("2025-09-01T00:00:00.000Z");
    expect(row.amountCents).toBe(1250);
    expect(row.type).toBe("EXPENSE");
    expect(row.categoryName).toBe("餐饮");
    expect(row.note).toBe("午饭");
  });

  it("accepts Chinese CSV headers", () => {
    const row = normalizeRow({ 日期: "2025-09-02", 金额: "3", 类型: "支出", 分类: "交通", 备注: "" });
    expect(row.amountCents).toBe(300);
    expect(row.categoryName).toBe("交通");
    expect(row.note).toBeNull();
  });

  it("falls back to amountCents when amount is absent", () => {
    const row = normalizeRow({ occurredOn: "2025-09-01", amountCents: 456 });
    expect(row.amountCents).toBe(456);
  });

  it("marks source as SUBSCRIPTION only with a resolvable subscription id", () => {
    expect(normalizeRow({ occurredOn: "2025-09-01", amount: "1", type: "expense", source: "订阅", subscriptionId: "s1" }).source).toBe("SUBSCRIPTION");
    expect(normalizeRow({ occurredOn: "2025-09-01", amount: "1", type: "expense", source: "订阅" }).source).toBe("MANUAL");
  });

  it("throws descriptive errors on bad dates, amounts, and types", () => {
    expect(() => normalizeRow({ occurredOn: "2025-02-30", amount: "1" })).toThrow("日期无效");
    expect(() => normalizeRow({ occurredOn: "2025-09-01", amount: "-2" })).toThrow("金额必须是非负数字");
    expect(() => normalizeRow({ occurredOn: "2025-09-01" })).toThrow("金额不能为空");
    expect(() => normalizeRow({ occurredOn: "2025-09-01", amount: "1", type: "理财收益" })).toThrow("类型只能是支出或收入");
  });
});

describe("import validation helpers", () => {
  it("parses typed amounts and integer cents", () => {
    expect(parseAmountToCents("1,234.50")).toBe(123450);
    expect(parseAmountToCents(0.1 + 0.2)).toBe(30);
    expect(parseCents("2000000000", "金额")).toBe(2_000_000_000);
    expect(parseSignedCents("-5", "金额")).toBe(-5);
    expect(() => parseCents("1.5", "金额")).toThrow("格式不正确");
    expect(() => parseCents("3000000000", "金额")).toThrow("格式不正确");
    expect(() => parseCents("", "金额")).toThrow("金额不能为空");
    expect(() => parseSignedCents("abc", "金额")).toThrow("格式不正确");
  });

  it("parses booleans and transaction types leniently", () => {
    expect(parseBoolean("true", false)).toBe(true);
    expect(parseBoolean("0", true)).toBe(false);
    expect(parseBoolean(undefined, true)).toBe(true);
    expect(parseTransactionType("收入")).toBe("INCOME");
    expect(parseTransactionType("income")).toBe("INCOME");
    expect(parseTransactionType("")).toBe("EXPENSE");
    expect(() => parseTransactionType("报销")).toThrow("类型只能是支出或收入");
  });

  it("validateRowShallow accepts good rows and rejects bad ones", () => {
    expect(() => validateRowShallow({ occurredOn: "2025-09-01", amount: "9.9", type: "支出" })).not.toThrow();
    expect(() => validateRowShallow({ occurredOn: "not-a-date", amount: "9.9" })).toThrow();
    expect(() => validateRowShallow({ occurredOn: "2025-09-01", amount: "x" })).toThrow();
  });
});
