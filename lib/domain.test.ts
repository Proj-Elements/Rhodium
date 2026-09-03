import { describe, expect, it } from "vitest";
import { addMonths, billingDate, calculateRemaining, calculateUsage, daysInMonth, moneyToCents, parseDateOnly, parseMonth } from "@/lib/domain";

describe("domain money and budget rules", () => {
  it("converts yuan to integer cents without floating point drift", () => {
    expect(moneyToCents("12.34")).toBe(1234);
    expect(moneyToCents(0.1 + 0.2)).toBe(30);
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
    expect(calculateUsage(0, 100)).toBeNull();
    expect(billingDate("2025-02", 31).toISOString().slice(0, 10)).toBe("2025-02-28");
  });

  it("clamps the 31st subscription to the last day of shorter months", () => {
    expect(billingDate("2025-02", 31).toISOString().slice(0, 10)).toBe("2025-02-28");
    expect(billingDate("2025-04", 31).toISOString().slice(0, 10)).toBe("2025-04-30");
  });
});
