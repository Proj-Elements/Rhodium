import { describe, expect, it } from "vitest";
import { planBillingCandidates, type SubscriptionPlanInput } from "@/lib/subscription-planner";

function subscription(overrides: Partial<SubscriptionPlanInput> = {}): SubscriptionPlanInput {
  return {
    id: "sub-1",
    amountCents: 1500,
    billingDay: 15,
    categoryId: "cat-1",
    note: null,
    name: "视频会员",
    startMonth: new Date("2025-01-01T00:00:00.000Z"),
    endMonth: null,
    ...overrides,
  };
}

describe("subscription billing planner", () => {
  it("creates one candidate per elapsed month with a default note", () => {
    const candidates = planBillingCandidates([subscription()], "2025-03-20");
    expect(candidates.map((candidate) => candidate.month)).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(candidates[0].note).toBe("视频会员 · 自动记账");
    expect(candidates[0].amountCents).toBe(1500);
  });

  it("clamps day 31 to the last day of short months and skips future due dates", () => {
    // Reference 2025-04-02: April's clamped due date (2025-04-30) is in the future.
    const candidates = planBillingCandidates([subscription({ billingDay: 31 })], "2025-04-02");
    expect(candidates.map((candidate) => candidate.dueDate.toISOString().slice(0, 10))).toEqual([
      "2025-01-31",
      "2025-02-28",
      "2025-03-31",
    ]);
  });

  it("skips occurrences whose due date has not arrived yet this month", () => {
    const candidates = planBillingCandidates([subscription({ billingDay: 20 })], "2025-03-15");
    expect(candidates.map((candidate) => candidate.month)).toEqual(["2025-01", "2025-02"]);
  });

  it("respects the start month window", () => {
    const candidates = planBillingCandidates([subscription({ startMonth: new Date("2025-02-01T00:00:00.000Z") })], "2025-03-20");
    expect(candidates.map((candidate) => candidate.month)).toEqual(["2025-02", "2025-03"]);
  });

  it("respects the end month window", () => {
    const candidates = planBillingCandidates([subscription({ endMonth: new Date("2025-02-01T00:00:00.000Z") })], "2025-03-20");
    expect(candidates.map((candidate) => candidate.month)).toEqual(["2025-01", "2025-02"]);
  });

  it("ignores subscriptions starting in the future", () => {
    const candidates = planBillingCandidates([subscription({ startMonth: new Date("2025-06-01T00:00:00.000Z") })], "2025-03-20");
    expect(candidates).toEqual([]);
  });

  it("uses the subscription note verbatim when present", () => {
    const candidates = planBillingCandidates([subscription({ note: "  家庭套餐  " })], "2025-01-31");
    expect(candidates[0].note).toBe("家庭套餐");
  });
});
