import { describe, expect, it } from "vitest";
import { changeBillingPause, isBillingPaused, parseBillingPauses } from "@/lib/billing-pauses";

describe("billing pause history", () => {
  it("records an inclusive start and exclusive resumption without losing older pauses", () => {
    const old = [{ start: "2024-01-01", end: "2024-02-01" }];
    const paused = changeBillingPause(old, true, "2024-03-01");
    expect(changeBillingPause(paused, true, "2024-03-02")).toEqual(paused);
    const resumed = changeBillingPause(paused, false, "2024-04-01");
    expect(resumed).toEqual([...old, { start: "2024-03-01", end: "2024-04-01" }]);
    expect(isBillingPaused(resumed, "2024-03-01")).toBe(true);
    expect(isBillingPaused(resumed, "2024-04-01")).toBe(false);
  });

  it("allows pausing and resuming on the same day without suppressing that day's charge", () => {
    const resumed = changeBillingPause(changeBillingPause([], true, "2024-03-01"), false, "2024-03-01");
    expect(isBillingPaused(resumed, "2024-03-01")).toBe(false);
  });

  it.each([
    null,
    {},
    [{ start: "2024-02-31", end: null }],
    [{ start: "2024-03-01", end: "2024-02-01" }],
    [{ start: "2024-01-01", end: null }, { start: "2024-03-01", end: null }],
  ])("rejects malformed or overlapping history %j", (value) => {
    expect(() => parseBillingPauses(value)).toThrow();
  });
});
