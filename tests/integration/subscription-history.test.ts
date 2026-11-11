import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listSubscriptions, POST as createSubscription } from "@/app/api/subscriptions/route";
import { PATCH as editSubscription } from "@/app/api/subscriptions/[id]/route";
import { PATCH as editCategory } from "@/app/api/categories/[id]/route";
import { initialBillingHistory } from "@/lib/billing-history";
import { parseDateOnly } from "@/lib/domain";
import { resetSubscriptionSyncCache, syncSubscriptions } from "@/lib/subscriptions";
import { createCategory, prisma, resetDatabase, routeContext } from "./helpers";

function request(path: string, method: string, body: unknown) {
  return new Request(`http://localhost/api/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function at(date: string) {
  vi.setSystemTime(new Date(`${date}T04:00:00.000Z`));
}

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("subscription history across route mutations", () => {
  it("does not backfill the paused months when a subscription resumes", async () => {
    at("2024-01-10");
    const category = await createCategory();
    const response = await createSubscription(request("subscriptions", "POST", { name: "网盘", categoryId: category.id, amount: "10", billingDay: 5, startMonth: "2024-01" }));
    expect(response.status).toBe(201);
    const { subscription } = await response.json();
    at("2024-02-01");
    expect((await editSubscription(request("subscriptions", "PATCH", { active: false }), routeContext({ id: subscription.id }))).status).toBe(200);
    at("2024-11-01");
    expect((await editSubscription(request("subscriptions", "PATCH", { active: true }), routeContext({ id: subscription.id }))).status).toBe(200);
    await syncSubscriptions("2024-11-10");
    const rows = await prisma.transaction.findMany({ orderBy: { occurredOn: "asc" } });
    expect(rows.map((row) => row.subscriptionMonth?.toISOString().slice(0, 7))).toEqual(["2024-01", "2024-11"]);
  });

  it("does not backfill dates that fell within a category's archived period", async () => {
    at("2024-01-10");
    const category = await createCategory();
    await createSubscription(request("subscriptions", "POST", { name: "会员", categoryId: category.id, amount: "10", billingDay: 5, startMonth: "2024-01" }));
    at("2024-02-01");
    expect((await editCategory(request("categories", "PATCH", { archived: true }), routeContext({ id: category.id }))).status).toBe(200);
    at("2024-11-01");
    expect((await editCategory(request("categories", "PATCH", { archived: false }), routeContext({ id: category.id }))).status).toBe(200);
    await syncSubscriptions("2024-11-10");
    const rows = await prisma.transaction.findMany({ orderBy: { occurredOn: "asc" } });
    expect(rows.map((row) => row.subscriptionMonth?.toISOString().slice(0, 7))).toEqual(["2024-01", "2024-11"]);
  });

  it("backfills old known prices and starts an edited price only next month", async () => {
    at("2024-03-10");
    const category = await createCategory();
    const plan = { name: "会员", categoryId: category.id, amountCents: 1000, billingDay: 5, startMonth: "2024-01", endMonth: null, note: null };
    const subscription = await prisma.subscription.create({ data: { ...plan, startMonth: parseDateOnly("2024-01-01"), billingHistory: initialBillingHistory(plan) } });
    const response = await editSubscription(request("subscriptions", "PATCH", { name: "会员", categoryId: category.id, amount: "25", billingDay: 20, startMonth: "2024-01", active: true }), routeContext({ id: subscription.id }));
    expect(response.status).toBe(200);
    expect((await response.json()).subscription).toMatchObject({ amountCents: 2500, currentAmountCents: 1000, billingEffectiveMonth: "2024-04" });
    expect((await prisma.transaction.findMany()).map((row) => row.amountCents)).toEqual([1000, 1000, 1000]);
    await syncSubscriptions("2024-04-30");
    const april = await prisma.transaction.findFirst({ where: { subscriptionMonth: parseDateOnly("2024-04-01") } });
    expect(april).toMatchObject({ amountCents: 2500, occurredOn: parseDateOnly("2024-04-20") });
  });

  it("reports unknown historical prices instead of creating guessed charges", async () => {
    at("2024-03-10");
    const category = await createCategory();
    const plan = { name: "旧会员", categoryId: category.id, amountCents: 2500, billingDay: 5, startMonth: "2024-01", endMonth: null, note: null };
    const subscription = await prisma.subscription.create({ data: { ...plan, startMonth: parseDateOnly("2024-01-01"), billingHistory: initialBillingHistory(plan, "2024-03") } });
    const result = await syncSubscriptions("2024-03-10");
    expect(result).toMatchObject({ created: 1, skippedUnknownHistory: 1, historyWarnings: [{ subscriptionId: subscription.id, knownFrom: "2024-03" }] });
    expect((await prisma.transaction.findMany()).map((row) => row.subscriptionMonth?.toISOString().slice(0, 7))).toEqual(["2024-03"]);
  });

  it("reads subscriptions without creating missing occurrences", async () => {
    at("2024-03-10");
    const category = await createCategory();
    const plan = { name: "旧会员", categoryId: category.id, amountCents: 2500, billingDay: 5, startMonth: "2024-01", endMonth: null, note: null };
    await prisma.subscription.create({ data: { ...plan, startMonth: parseDateOnly("2024-01-01"), billingHistory: initialBillingHistory(plan) } });
    expect((await listSubscriptions()).status).toBe(200);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("streams more than one occurrence batch and records every created charge", async () => {
    const category = await createCategory();
    const plan = { name: "长账期", categoryId: category.id, amountCents: 100, billingDay: 5, startMonth: "1980-01", endMonth: null, note: null };
    await prisma.subscription.create({ data: { ...plan, startMonth: parseDateOnly("1980-01-01"), billingHistory: initialBillingHistory(plan) } });
    const result = await syncSubscriptions("2024-03-10");
    expect(result.created).toBe(531);
    expect(await prisma.transactionHistory.count()).toBe(531);
    resetSubscriptionSyncCache();
    expect((await syncSubscriptions("2024-03-10")).created).toBe(0);
  });
});
