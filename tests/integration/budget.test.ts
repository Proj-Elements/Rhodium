import { beforeEach, describe, expect, it } from "vitest";
import { GET as getBudget, PUT as putBudget } from "@/app/api/budgets/[month]/route";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import { POST as settleMonth } from "@/app/api/settlements/[month]/settle/route";
import { resolveBudget, setBudgetPreset } from "@/lib/budget";
import { monthStart } from "@/lib/domain";
import { getMonthSummary } from "@/lib/summary";
import { addTransaction, createCategory, prisma, resetDatabase, routeContext } from "./helpers";

const MONTH = "2024-03";

function putRequest(url: string, amount: string) {
  return new Request(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount }),
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
});

describe("PUT /api/budgets/[month]?scope=future", () => {
  it("covers exactly the 240 month window and leaves later months alone", async () => {
    await prisma.monthlyBudget.createMany({
      data: [
        { month: monthStart("2035-05"), amountCents: 999 },
        { month: monthStart("2050-01"), amountCents: 999 },
      ],
    });

    const response = await putBudget(putRequest("http://localhost/api/budgets/2030-01?scope=future", "1500"), routeContext({ month: "2030-01" }));
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
    const response = await putBudget(putRequest("http://localhost/api/budgets/2030-02", "1,234.56"), routeContext({ month: "2030-02" }));
    const payload = (await response.json()) as { budget: { amountCents: number }; scope: string };

    expect(payload).toEqual({ budget: { amountCents: 123_456 }, scope: "month" });

    const read = await getBudget(new Request("http://localhost/api/budgets/2030-02"), routeContext({ month: "2030-02" }));
    expect(await read.json()).toEqual({ budget: { amountCents: 123_456 }, preset: null, effectiveBudgetCents: 123_456 });
  });
});
