import { describe, expect, it } from "vitest";
import { applySubscriptionRemoval, nextSubscriptionDate, subscriptionState } from "./subscription-view";
import type { SubscriptionDTO } from "./types";

const item: SubscriptionDTO = {
  id: "subscription-1", name: "校园网", amountCents: 3000, billingDay: 31, categoryId: "category-1",
  category: { id: "category-1", name: "生活", type: "EXPENSE", icon: null, isSystem: true, sortOrder: 0, archivedAt: null },
  startMonth: "2026-01-01", endMonth: null, active: true, note: null,
};

describe("subscription display state", () => {
  it("distinguishes current, upcoming, ended, paused and archived categories", () => {
    expect(subscriptionState(item, "2026-11-03")).toBe("current");
    expect(subscriptionState({ ...item, startMonth: "2026-12-01" }, "2026-11-03")).toBe("upcoming");
    expect(subscriptionState({ ...item, endMonth: "2026-10-01" }, "2026-11-03")).toBe("ended");
    expect(subscriptionState({ ...item, active: false }, "2026-11-03")).toBe("paused");
    expect(subscriptionState({ ...item, category: { ...item.category, archivedAt: "2026-11-01" } }, "2026-11-03")).toBe("archived");
  });

  it("includes the whole inclusive end month", () => {
    expect(subscriptionState({ ...item, endMonth: "2026-11-01" }, "2026-11-30")).toBe("current");
  });
});

describe("next scheduled ledger date", () => {
  it("clamps the 31st to the real end of a short month", () => {
    expect(nextSubscriptionDate(item, "2026-11-03")).toBe("2026-11-30");
    expect(nextSubscriptionDate(item, "2028-02-01")).toBe("2028-02-29");
  });

  it("keeps today's due date and advances a passed due date", () => {
    expect(nextSubscriptionDate({ ...item, billingDay: 3 }, "2026-11-03")).toBe("2026-11-03");
    expect(nextSubscriptionDate({ ...item, billingDay: 2 }, "2026-11-03")).toBe("2026-12-02");
  });

  it("respects a future start month and an inclusive end month", () => {
    expect(nextSubscriptionDate({ ...item, startMonth: "2026-12-01" }, "2026-11-03")).toBe("2026-12-31");
    expect(nextSubscriptionDate({ ...item, endMonth: "2026-11-01", billingDay: 2 }, "2026-11-03")).toBeNull();
  });

  it("does not promise a billing date for paused, ended or archived items", () => {
    expect(nextSubscriptionDate({ ...item, active: false }, "2026-11-03")).toBeNull();
    expect(nextSubscriptionDate({ ...item, endMonth: "2026-10-01" }, "2026-11-03")).toBeNull();
    expect(nextSubscriptionDate({ ...item, category: { ...item.category, archivedAt: "2026-11-01" } }, "2026-11-03")).toBeNull();
  });
});

describe("subscription removal response", () => {
  it("removes hard-deleted rows instead of leaving a ghost card", () => {
    expect(applySubscriptionRemoval([item], item.id, { deleted: true })).toEqual([]);
  });

  it("retains archived items using the updated server record", () => {
    const archived = { ...item, active: false };
    expect(applySubscriptionRemoval([item], item.id, { subscription: archived })).toEqual([archived]);
  });

  it("preserves unrelated records and never mutates its input", () => {
    const other = { ...item, id: "subscription-2" };
    const source = [item, other];
    expect(applySubscriptionRemoval(source, item.id, { deleted: true })).toEqual([other]);
    expect(source).toEqual([item, other]);
  });
});
