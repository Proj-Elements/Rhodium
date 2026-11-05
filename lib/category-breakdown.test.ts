import { describe, expect, it } from "vitest";
import { expenseSharePercent } from "./category-breakdown";

describe("category expense share", () => {
  it("calculates the category's share in integer cents", () => {
    expect(expenseSharePercent(2500, 10000)).toBe(25);
  });

  it("rounds fractional percentages for the legend", () => {
    expect(expenseSharePercent(100, 300)).toBe(33);
  });

  it("shows zero for a zero-amount category", () => {
    expect(expenseSharePercent(0, 10000)).toBe(0);
  });

  it("never renders NaN when all recorded expenses are zero", () => {
    expect(expenseSharePercent(0, 0)).toBe(0);
    expect(expenseSharePercent(100, 0)).toBe(0);
  });
});
