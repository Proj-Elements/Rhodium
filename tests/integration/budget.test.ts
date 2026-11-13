import { beforeEach, describe, expect, it } from "vitest";
import { GET as getBudget, PUT as putBudget } from "@/app/api/budgets/[month]/route";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import { GET as getSettlements } from "@/app/api/settlements/route";
import { GET as getSettlement } from "@/app/api/settlements/[month]/route";
import { POST as settleMonth } from "@/app/api/settlements/[month]/settle/route";
import { resolveBudget, saveMonthlyBudget, setBudgetPreset } from "@/lib/budget";
import { monthStart, todayInShanghai } from "@/lib/domain";
import { getMonthSummary } from "@/lib/summary";
import { withLedgerRead } from "@/lib/ledger-write";
import { addTransaction, createCategory, prisma, resetDatabase, routeContext } from "./helpers";

const MONTH = "2024-03";

async function putRequest(url: string, amount: string) {
  const month = new URL(url).pathname.split("/").at(-1)!;
  const version = await (await getBudget(new Request(url), routeContext({ month }))).json();
  return new Request(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount, expectedVersion: new URL(url).searchParams.get("scope") === "future" ? version.futureVersion : version.version }),
  });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("resolveBudget", () => {
  it("reports no budget when neither a month row nor a preset exists", async () => {
    expect(await resolveBudget(MONTH)).toEqual({ amountCents: null, source: "none" });
  });

  it("falls back to the preset", async () => {
    await setBudgetPreset(200_000);
    expect(await resolveBudget(MONTH)).toEqual({ amountCents: 200_000, source: "preset" });
  });

  it("prefers an explicit month row over the preset", async () => {
    await setBudgetPreset(200_000);
    await prisma.monthlyBudget.create({ data: { month: monthStart(MONTH), amountCents: 150_000 } });
    expect(await resolveBudget(MONTH)).toEqual({ amountCents: 150_000, source: "month" });
  });
});

describe("saveMonthlyBudget", () => {
  it("creates and updates one explicit month without changing the preset", async () => {
    await setBudgetPreset(200_000);
    await saveMonthlyBudget(MONTH, 150_000);
    expect(await resolveBudget(MONTH)).toEqual({ amountCents: 150_000, source: "month" });

    await saveMonthlyBudget(MONTH, 125_000);
    expect(await resolveBudget(MONTH)).toEqual({ amountCents: 125_000, source: "month" });
    expect(await prisma.monthlyBudget.count()).toBe(1);
    expect((await prisma.budgetPreset.findUniqueOrThrow({ where: { id: 1 } })).amountCents).toBe(200_000);
  });

  it("keeps a zero budget explicit instead of falling back to the preset", async () => {
    await setBudgetPreset(200_000);
    await saveMonthlyBudget(MONTH, 0);
    expect(await resolveBudget(MONTH)).toEqual({ amountCents: 0, source: "month" });
  });

  it("does not let the shared helper rewrite a settled budget", async () => {
    await saveMonthlyBudget(MONTH, 1000);
    await settleMonth(new Request(`http://localhost/api/settlements/${MONTH}/settle`, { method: "POST" }), routeContext({ month: MONTH }));
    await expect(saveMonthlyBudget(MONTH, 2000)).rejects.toThrow("已经结算");
    expect(await resolveBudget(MONTH)).toEqual({ amountCents: 1000, source: "settlement" });
  });
});

describe("getMonthSummary", () => {
  it("inherits the preset so remaining is computed instead of null", async () => {
    const category = await createCategory();
    await setBudgetPreset(200_000);
    await addTransaction({ categoryId: category.id, date: `${MONTH}-05`, amountCents: 30_000 });

    const summary = await getMonthSummary(MONTH);

    expect(summary.budgetCents).toBe(200_000);
    expect(summary.budgetSource).toBe("preset");
    expect(summary.expenseCents).toBe(30_000);
    expect(summary.remainingCents).toBe(170_000);
  });

  it("keeps remaining null when no budget is configured at all", async () => {
    const category = await createCategory();
    await addTransaction({ categoryId: category.id, date: `${MONTH}-05`, amountCents: 30_000 });

    const summary = await getMonthSummary(MONTH);

    expect(summary.budgetCents).toBeNull();
    expect(summary.budgetSource).toBe("none");
    expect(summary.remainingCents).toBeNull();
  });
});

describe("settlement snapshot", () => {
  it("stores the preset amount instead of zero", async () => {
    const category = await createCategory();
    await setBudgetPreset(200_000);
    await addTransaction({ categoryId: category.id, date: `${MONTH}-05`, amountCents: 30_000 });

    const response = await settleMonth(new Request(`http://localhost/api/settlements/${MONTH}/settle`, { method: "POST" }), routeContext({ month: MONTH }));
    const payload = (await response.json()) as { settlement: { budgetAmountCents: number; remainingAmountCents: number | null } };

    expect(response.status).toBe(200);
    expect(payload.settlement.budgetAmountCents).toBe(200_000);
    expect(payload.settlement.remainingAmountCents).toBe(170_000);
  });

  it("keeps settled summary and dashboard amounts frozen when the preset changes", async () => {
    const category = await createCategory();
    await setBudgetPreset(200_000);
    await addTransaction({ categoryId: category.id, date: `${MONTH}-05`, amountCents: 30_000 });
    await settleMonth(new Request(`http://localhost/api/settlements/${MONTH}/settle`, { method: "POST" }), routeContext({ month: MONTH }));

    await setBudgetPreset(300_000);
    await prisma.category.update({ where: { id: category.id }, data: { name: "更新后的餐饮" } });

    const summary = await getMonthSummary(MONTH);
    expect(summary).toMatchObject({ budgetCents: 200_000, expenseCents: 30_000, remainingCents: 170_000 });
    expect(summary.topCategory).toEqual({ name: "餐饮", amountCents: 30_000 });

    const response = await getDashboard(new Request(`http://localhost/api/dashboard?month=${MONTH}`));
    const payload = (await response.json()) as { budget: { amountCents: number } | null; expenseCents: number; remainingCents: number | null };
    expect(payload).toMatchObject({ budget: { amountCents: 200_000 }, expenseCents: 30_000, remainingCents: 170_000, categoryBreakdown: [{ categoryId: category.id, categoryName: "餐饮", amountCents: 30_000 }] });

    const budgetResponse = await getBudget(new Request(`http://localhost/api/budgets/${MONTH}`), routeContext({ month: MONTH }));
    expect(await budgetResponse.json()).toMatchObject({ budget: { amountCents: 200_000 }, effectiveBudgetCents: 200_000, source: "settlement", locked: true });
  });
});

describe("dashboard budget", () => {
  it("exposes the preset as the effective budget", async () => {
    const category = await createCategory();
    await setBudgetPreset(200_000);
    await addTransaction({ categoryId: category.id, date: `${MONTH}-05`, amountCents: 30_000 });

    const response = await getDashboard(new Request(`http://localhost/api/dashboard?month=${MONTH}`));
    const payload = (await response.json()) as { budget: { amountCents: number } | null; budgetSource: string; remainingCents: number | null };

    expect(response.status).toBe(200);
    expect(payload.budget).toEqual({ amountCents: 200_000 });
    expect(payload.budgetSource).toBe("preset");
    expect(payload.remainingCents).toBe(170_000);
  });

  it("uses out-of-pocket expenses for the focus day and month", async () => {
    const category = await createCategory();
    await addTransaction({ categoryId: category.id, date: `${MONTH}-31`, amountCents: 3000 });
    const reimbursed = await addTransaction({ categoryId: category.id, date: `${MONTH}-31`, amountCents: 5000 });
    await prisma.transaction.update({ where: { id: reimbursed.id }, data: { reimbursedAt: new Date() } });

    const response = await getDashboard(new Request(`http://localhost/api/dashboard?month=${MONTH}`));
    expect(await response.json()).toMatchObject({ expenseCents: 3000, outOfPocketCents: 3000, focusDateExpenseCents: 3000, reimbursedCents: 5000 });
  });

  it("keeps a configured zero budget distinct from an unset budget", async () => {
    await setBudgetPreset(0);
    const response = await getDashboard(new Request(`http://localhost/api/dashboard?month=${MONTH}`));

    expect(await response.json()).toMatchObject({ budget: { amountCents: 0 }, budgetSource: "preset", usagePercent: 0, remainingCents: 0 });
  });
});

describe("snapshot reads", () => {
  it("holds one snapshot when a concurrent writer changes ledger rows", async () => {
    const category = await createCategory();
    const transaction = await addTransaction({ categoryId: category.id, date: `${MONTH}-05`, amountCents: 3000 });

    const captured = await withLedgerRead(async (tx) => {
      const before = await tx.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
      await prisma.transaction.update({ where: { id: transaction.id }, data: { amountCents: 7000 } });
      const after = await tx.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
      return [before.amountCents, after.amountCents];
    });

    expect(captured).toEqual([3000, 3000]);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } })).amountCents).toBe(7000);
  });

  it("prevents accidental writes from a read transaction", async () => {
    await expect(withLedgerRead((tx) => tx.budgetPreset.create({ data: { id: 1, amountCents: 1000 } }))).rejects.toThrow();
    expect(await prisma.budgetPreset.count()).toBe(0);
  });

  it("does not create subscription charges through dashboard or monthly GET requests", async () => {
    const category = await createCategory();
    const currentMonth = todayInShanghai().slice(0, 7);
    await prisma.subscription.create({ data: { name: "只读查询", amountCents: 1000, billingDay: 1, categoryId: category.id, startMonth: monthStart(currentMonth) } });

    const dashboard = await getDashboard(new Request(`http://localhost/api/dashboard?month=${currentMonth}`));
    const summaries = await getSettlements(new Request(`http://localhost/api/settlements?end=${currentMonth}`));
    const summary = await getSettlement(new Request(`http://localhost/api/settlements/${currentMonth}`), routeContext({ month: currentMonth }));

    expect([dashboard.status, summaries.status, summary.status]).toEqual([200, 200, 200]);
    expect(await prisma.transaction.count()).toBe(0);
  });
});

describe("PUT /api/budgets/[month]?scope=future", () => {
  it("covers exactly the 240 month window and leaves later months alone", async () => {
    await prisma.monthlyBudget.createMany({
      data: [
        { month: monthStart("2035-05"), amountCents: 999 },
        { month: monthStart("2050-01"), amountCents: 999 },
      ],
    });

    const response = await putBudget(await putRequest("http://localhost/api/budgets/2030-01?scope=future", "1500"), routeContext({ month: "2030-01" }));
    const payload = (await response.json()) as { budget: { amountCents: number }; monthsSet: number };

    expect(response.status).toBe(200);
    expect(payload.budget.amountCents).toBe(150_000);
    expect(payload.monthsSet).toBe(240);

    const [first, insideExisting, last, outside] = await Promise.all([
      prisma.monthlyBudget.findUnique({ where: { month: monthStart("2030-01") } }),
      prisma.monthlyBudget.findUnique({ where: { month: monthStart("2035-05") } }),
      prisma.monthlyBudget.findUnique({ where: { month: monthStart("2049-12") } }),
      prisma.monthlyBudget.findUnique({ where: { month: monthStart("2050-01") } }),
    ]);

    expect(first?.amountCents).toBe(150_000);
    expect(insideExisting?.amountCents).toBe(150_000);
    expect(last?.amountCents).toBe(150_000);
    expect(outside?.amountCents).toBe(999);
    expect(await prisma.monthlyBudget.count()).toBe(241);
  });

  it("returns the parsed amount the client should display", async () => {
    const response = await putBudget(await putRequest("http://localhost/api/budgets/2030-02", "1,234.56"), routeContext({ month: "2030-02" }));
    const payload = (await response.json()) as { budget: { amountCents: number }; scope: string };

    expect(payload).toMatchObject({ budget: { amountCents: 123_456 }, scope: "month" });

    const read = await getBudget(new Request("http://localhost/api/budgets/2030-02"), routeContext({ month: "2030-02" }));
    expect(await read.json()).toMatchObject({ budget: { amountCents: 123_456 }, preset: null, effectiveBudgetCents: 123_456, source: "month", locked: false });
  });
});
