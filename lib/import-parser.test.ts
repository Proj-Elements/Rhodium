import { describe, expect, it } from "vitest";
import {
  normalizeRow,
  parseAmountToCents,
  parseBoolean,
  parseCategoryType,
  parseCents,
  parseMonthValue,
  parseSignedCents,
  parseTransactionType,
  optionalDateTime,
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

  it("preserves reimbursement timestamps with either header spelling", () => {
    const base = { occurredOn: "2025-09-01", amountCents: 456 };
    const timestamp = "2025-09-02T08:00:00.000Z";
    expect(normalizeRow({ ...base, reimbursedAt: timestamp }).reimbursedAt?.toISOString()).toBe(timestamp);
    expect(normalizeRow({ ...base, 报销时间: timestamp }).reimbursedAt?.toISOString()).toBe(timestamp);
    expect(normalizeRow(base).reimbursedAt).toBeNull();
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

  it.each(["0x10", "1e3", "1,2,3", "1,00", "Infinity"])("rejects ambiguous decimal amounts: %s", (amount) => {
    expect(() => parseAmountToCents(amount)).toThrow();
  });

  it.each(["0x10", "1e3", "1,000", "1,2", "", null, undefined, true, "1.0"])("only accepts decimal integer cents: %s", (amount) => {
    expect(() => parseCents(amount, "金额")).toThrow();
    expect(() => parseSignedCents(amount, "金额")).toThrow();
  });

  it("parses booleans and transaction types leniently", () => {
    expect(parseBoolean("true", false)).toBe(true);
    expect(parseBoolean("0", true)).toBe(false);
    expect(parseBoolean(undefined, true)).toBe(true);
    expect(parseTransactionType("收入")).toBe("INCOME");
    expect(parseTransactionType("income")).toBe("INCOME");
    expect(parseTransactionType("")).toBe("EXPENSE");
    expect(() => parseTransactionType("报销")).toThrow("类型只能是支出或收入");
    expect(() => parseTransactionType("伪造支出类型")).toThrow();
    expect(() => parseCategoryType("UNKNOWN")).toThrow();
    expect(() => parseBoolean("maybe", true)).toThrow();
  });

  it("keeps per-row limits while accepting the signed Int settlement boundaries", () => {
    expect(() => parseCents(2_147_483_647, "金额")).toThrow();
    expect(parseCents(2_147_483_647, "结算支出金额", 2_147_483_647)).toBe(2_147_483_647);
    expect(parseSignedCents(-2_147_483_648, "结算剩余金额", -2_147_483_648, 2_147_483_647)).toBe(-2_147_483_648);
    expect(() => parseCents(2_147_483_648, "结算支出金额", 2_147_483_647)).toThrow();
    expect(() => parseSignedCents(-2_147_483_649, "结算剩余金额", -2_147_483_648, 2_147_483_647)).toThrow();
  });

  it("validateRowShallow accepts good rows and rejects bad ones", () => {
    expect(() => validateRowShallow({ occurredOn: "2025-09-01", amount: "9.9", type: "支出" })).not.toThrow();
    expect(() => validateRowShallow({ occurredOn: "not-a-date", amount: "9.9" })).toThrow();
    expect(() => validateRowShallow({ occurredOn: "2025-09-01", amount: "x" })).toThrow();
  });

  it("validateRowShallow accepts amountCents exactly like normalizeRow does", () => {
    expect(() => validateRowShallow({ occurredOn: "2025-09-01", amountCents: 456 })).not.toThrow();
    // The backup schema and normalizeRow both take string cents; the preview
    // used to reject them, which disabled 确认导入 for valid files.
    expect(() => validateRowShallow({ occurredOn: "2025-09-01", amountCents: "2500" })).not.toThrow();
    expect(() => validateRowShallow({ occurredOn: "2025-09-01" })).toThrow("金额不能为空");
    expect(() => validateRowShallow({ occurredOn: "2025-09-01", amountCents: "1.5" })).toThrow();
  });

  it("rejects invalid reimbursement timestamps in both preview and import", () => {
    const row = { occurredOn: "2025-09-01", amountCents: 456, reimbursedAt: "not-a-date" };
    expect(() => normalizeRow(row)).toThrow("报销时间格式不正确");
    expect(() => validateRowShallow(row)).toThrow("报销时间格式不正确");
  });

  it.each(["2025-09-02", "2025-09-02 08:00:00", "2025-02-30T08:00:00Z", "2025-09-02T24:00:00Z", "2025-09-02T08:60:00Z"])("requires a real ISO timestamp with a timezone: %s", (timestamp) => {
    expect(() => optionalDateTime(timestamp, "时间")).toThrow("时间格式不正确");
  });

  it("accepts ISO timestamps with explicit offsets", () => {
    expect(optionalDateTime("2025-09-02T08:00:00+08:00", "时间")?.toISOString()).toBe("2025-09-02T00:00:00.000Z");
  });

  it.each(["0001-01-01T00:00:00+01:00", "9999-12-31T23:59:59-01:00"])("rejects timestamps whose UTC year leaves the backup domain: %s", (timestamp) => {
    expect(() => optionalDateTime(timestamp, "时间")).toThrow("时间格式不正确");
  });

  it("preserves valid offset conversions at both supported year boundaries", () => {
    expect(optionalDateTime("0001-01-01T01:00:00+01:00", "时间")?.toISOString()).toBe("0001-01-01T00:00:00.000Z");
    expect(optionalDateTime("9999-12-31T22:59:59-01:00", "时间")?.toISOString()).toBe("9999-12-31T23:59:59.000Z");
  });

  it("requires subscription and metadata months to be exact month values", () => {
    expect(parseMonthValue("2025-09", "月份").toISOString()).toBe("2025-09-01T00:00:00.000Z");
    expect(parseMonthValue("2025-09-01", "月份").toISOString()).toBe("2025-09-01T00:00:00.000Z");
    expect(() => parseMonthValue("2025-09-02", "月份")).toThrow();
    expect(() => parseMonthValue("2025-09junk", "月份")).toThrow();
    expect(() => normalizeRow({ occurredOn: "2025-09-01", amountCents: 100, subscriptionMonth: "2025-09-02" })).toThrow("月初日期");
    expect(() => validateRowShallow({ occurredOn: "2025-09-01", amountCents: 100, deletedAt: "2025-09-02" })).toThrow("删除时间");
  });

  it("preserves historical note text and timestamps only when restoring a backup", () => {
    const input = {
      occurredOn: "2025-09-01", amountCents: 100, note: `  ${"测".repeat(201)}\n`,
      createdAt: "2025-09-01T00:00:00.000Z", updatedAt: "2025-09-03T10:00:00.000Z", version: 4,
    };
    const restored = normalizeRow(input, true);
    expect(restored.note).toBe(input.note);
    expect(restored.createdAt?.toISOString()).toBe(input.createdAt);
    expect(restored.updatedAt?.toISOString()).toBe(input.updatedAt);
    expect(restored.version).toBe(4);
    expect(() => normalizeRow(input)).toThrow("备注不能超过 200 字");
    const ordinary = normalizeRow({ ...input, note: "  text  " });
    expect(ordinary).toMatchObject({ note: "text", createdAt: null, updatedAt: null, version: null });
  });

  it("rejects inconsistent historical timestamps or transaction versions in preview too", () => {
    const input = { occurredOn: "2025-09-01", amountCents: 100, createdAt: "2025-09-03T00:00:00.000Z", updatedAt: "2025-09-01T00:00:00.000Z" };
    expect(() => validateRowShallow(input, true)).toThrow("更新时间不能早于创建时间");
    expect(() => validateRowShallow({ ...input, updatedAt: input.createdAt, version: 0 }, true)).toThrow("版本必须是正整数");
  });
});
