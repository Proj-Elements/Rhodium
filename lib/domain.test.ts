import { describe, expect, it } from "vitest";
import { addMonths, billingDate, calculateRemaining, calculateUsage, daysInMonth, moneyToCents, parseDateOnly, parseMonth } from "@/lib/domain";

describe("domain money and budget rules", () => {
  it("converts yuan to integer cents without floating point drift", () => {
    expect(moneyToCents("12.34")).toBe(1234);
    expect(moneyToCents(0.1 + 0.2)).toBe(30);
    expect(moneyToCents("1,234.56")).toBe(123456);
  });

  it("rounds a half cent up instead of losing it to binary drift", () => {
    // 1.005 * 100 === 100.49999999999999 in IEEE 754.
    expect(moneyToCents("1.005")).toBe(101);
    expect(moneyToCents("2.675")).toBe(268);
    expect(moneyToCents("1.234")).toBe(123);
  });

  it("rejects negative, blank, and out-of-range amounts", () => {
    expect(() => moneyToCents("-1")).toThrow("金额必须是非负数字");
    expect(() => moneyToCents("  ")).toThrow("金额不能为空");
    expect(() => moneyToCents("abc")).toThrow("金额必须是非负数字");
    expect(() => moneyToCents("20000000.01")).toThrow("金额超出可记录范围");
    expect(moneyToCents("20000000")).toBe(2_000_000_000);
  });

  it.each(["0x10", "1,2,3", "1e3", "1E3", "+1", "12,34.56", "1,000,00", "1 000", ".50", "1."])("rejects ambiguous amount notation %j", (amount) => {
    expect(() => moneyToCents(amount)).toThrow("金额必须是非负数字");
  });

  it("rounds using decimal digits even at the ceiling and below a cent", () => {
    expect(moneyToCents("19,999,999.995")).toBe(2_000_000_000);
    expect(moneyToCents("20000000.004999999999999999")).toBe(2_000_000_000);
    expect(() => moneyToCents("20000000.005")).toThrow("金额超出可记录范围");
    expect(() => moneyToCents("99999999999999999999999999999")).toThrow("金额超出可记录范围");
    expect(moneyToCents("0.004999999999999999")).toBe(0);
    expect(moneyToCents("0.005000000000000001")).toBe(1);
    expect(moneyToCents(1e-7)).toBe(0);
    expect(moneyToCents(1000)).toBe(100_000);
  });

  it("rejects malformed dates and months instead of normalizing them", () => {
    expect(() => parseDateOnly("2025-02-29")).toThrow("日期无效");
    expect(() => parseMonth("2025-13")).toThrow("月份格式应为 YYYY-MM");
  });

  it("keeps income out of remaining budget", () => {
    expect(calculateRemaining(300000, 12500)).toBe(287500);
    expect(calculateUsage(300000, 150000)).toBe(50);
    expect(calculateRemaining(null, 100)).toBeNull();
  });
});

describe("month boundaries", () => {
  it("handles month rollover and leap years", () => {
    expect(addMonths("2024-12", 1)).toBe("2025-01");
    expect(daysInMonth("2024-02")).toBe(29);
    expect(daysInMonth("2025-02")).toBe(28);
  });

  it("keeps empty budgets meaningful and clamps subscription billing dates", () => {
    expect(calculateUsage(null, 100)).toBeNull();
    expect(calculateUsage(0, 0)).toBe(0);
    expect(calculateUsage(0, 100)).toBe(100);
    expect(billingDate("2025-02", 31).toISOString().slice(0, 10)).toBe("2025-02-28");
  });

  it("clamps the 31st subscription to the last day of shorter months", () => {
    expect(billingDate("2025-02", 31).toISOString().slice(0, 10)).toBe("2025-02-28");
    expect(billingDate("2025-04", 31).toISOString().slice(0, 10)).toBe("2025-04-30");
  });
});
