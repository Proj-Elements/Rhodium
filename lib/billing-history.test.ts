import { describe, expect, it } from "vitest";
import { effectiveBillingPlan, initialBillingHistory, parseBillingHistory, scheduleBillingPlan, type BillingPlanData } from "@/lib/billing-history";

const plan: BillingPlanData = {
  amountCents: 1500,
  billingDay: 15,
  categoryId: "category-1",
  name: "音乐会员",
  note: null,
  startMonth: "2024-01",
  endMonth: null,
};

describe("effective subscription billing plans", () => {
  it("applies a newly declared initial price from the user's start month", () => {
    const history = initialBillingHistory(plan);
    expect(effectiveBillingPlan(history, "2023-12")).toBeNull();
    expect(effectiveBillingPlan(history, "2024-01")?.amountCents).toBe(1500);
  });

  it("keeps prior prices and schedules changes for next month", () => {
    const history = scheduleBillingPlan(initialBillingHistory(plan), { ...plan, amountCents: 2500, billingDay: 31 }, "2024-03-20");
    expect(history.map((item) => item.effectiveMonth)).toEqual(["2024-01", "2024-04"]);
    expect(effectiveBillingPlan(history, "2024-03")?.amountCents).toBe(1500);
    expect(effectiveBillingPlan(history, "2024-04")?.amountCents).toBe(2500);
  });

  it("replaces an unsatisfied scheduled revision without rewriting the old month", () => {
    const first = scheduleBillingPlan(initialBillingHistory(plan), { ...plan, amountCents: 2500 }, "2024-03-20");
    const revised = scheduleBillingPlan(first, { ...plan, amountCents: 3500 }, "2024-03-21");
    expect(revised).toHaveLength(2);
    expect(effectiveBillingPlan(revised, "2024-03")?.amountCents).toBe(1500);
    expect(effectiveBillingPlan(revised, "2024-04")?.amountCents).toBe(3500);
  });

  it("allows an unstarted future plan to move earlier without inventing earlier charges", () => {
    const history = scheduleBillingPlan(initialBillingHistory({ ...plan, startMonth: "2024-08" }), { ...plan, startMonth: "2024-06" }, "2024-03-20");
    expect(history).toHaveLength(1);
    expect(history[0].effectiveMonth).toBe("2024-06");
  });

  it.each([
    { history: [{ ...plan, effectiveMonth: "2024-13" }] },
    { history: [{ ...plan, effectiveMonth: "0000-01" }] },
    { history: [{ ...plan, effectiveMonth: "2024-01", amountCents: -1 }] },
    { history: [{ ...plan, effectiveMonth: "2024-01", billingDay: 32 }] },
    { history: [{ ...plan, effectiveMonth: "2024-01" }, { ...plan, effectiveMonth: "2024-01" }] },
  ])("rejects invalid or ambiguous imported history %j", ({ history }) => {
    expect(() => parseBillingHistory(history)).toThrow();
  });
});
