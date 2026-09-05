import { beforeEach, describe, expect, it } from "vitest";
import { POST as importRows } from "@/app/api/import/route";
import { GET as getSettlements } from "@/app/api/settlements/route";
import { setBudgetPreset, resolveBudget, resolveBudgets } from "@/lib/budget";
import { addMonths, monthStart } from "@/lib/domain";
import { getLockedMonths, getMonthSummaries, getMonthSummary, isMonthLocked } from "@/lib/summary";
import { addTransaction, createCategory, prisma, resetDatabase } from "./helpers";

const END = "2024-06";
const MONTHS = Array.from({ length: 6 }, (_, index) => addMonths(END, index - 5));

beforeEach(async () => {
  await resetDatabase();
});

describe("resolveBudgets", () => {
  it("matches resolveBudget for month rows, preset fallback and no budget", async () => {
    await setBudgetPreset(200_000);
    await prisma.monthlyBudget.create({ data: { month: monthStart("2024-02"), amountCents: 150_000 } });
    const batch = await resolveBudgets(MONTHS);
    for (const month of MONTHS) {
      expect(batch.get(month)).toEqual(await resolveBudget(month));
    }
  });

  it("reports none for every month when nothing is configured", async () => {
    const batch = await resolveBudgets(MONTHS);
    expect([...batch.values()]).toEqual(MONTHS.map(() => ({ amountCents: null, source: "none" })));
  });

  it("returns an empty map for no months", async () => {
    expect(await resolveBudgets([])).toEqual(new Map());
  });
});

describe("getMonthSummaries", () => {
  it("returns exactly what per-month getMonthSummary returns", async () => {
    const food = await createCategory("餐饮");
    const salary = await createCategory("工资", "INCOME");
    await setBudgetPreset(300_000);
    await prisma.monthlyBudget.create({ data: { month: monthStart("2024-04"), amountCents: 120_000 } });
    await addTransaction({ categoryId: food.id, date: "2024-02-05", amountCents: 3_300 });
    await addTransaction({ categoryId: food.id, date: "2024-04-05", amountCents: 1_200 });
    await addTransaction({ categoryId: food.id, date: "2024-04-05", amountCents: 800 });
    await addTransaction({ categoryId: food.id, date: "2024-04-18", amountCents: 5_000 });
    await addTransaction({ categoryId: salary.id, date: "2024-04-10", amountCents: 900_000, type: "INCOME" });
    await addTransaction({ categoryId: food.id, date: "2024-06-01", amountCents: 700 });
    const deleted = await addTransaction({ categoryId: food.id, date: "2024-06-02", amountCents: 4_000 });
    await prisma.transaction.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await prisma.monthlySettlement.create({
      data: {
        month: monthStart("2024-02"),
        budgetAmountCents: 300_000,
        expenseAmountCents: 3_300,
        incomeAmountCents: 0,
        remainingAmountCents: 296_700,
      },
    });

    const batch = await getMonthSummaries(MONTHS);
    const oneByOne = [];
    for (const month of MONTHS) oneByOne.push(await getMonthSummary(month));
    expect(batch).toEqual(oneByOne);
    expect(batch[3].month).toBe("2024-04");
    expect(batch[3].expenseCents).toBe(7_000);
    expect(batch[3].incomeCents).toBe(900_000);
    expect(batch[3].budgetSource).toBe("month");
    expect(batch[1].settlement).not.toBeNull();
    expect(batch[5].transactionCount).toBe(1);
  });

  it("keeps the requested order and returns nothing for no months", async () => {
    expect((await getMonthSummaries(["2024-06", "2024-01"])).map((summary) => summary.month)).toEqual(["2024-06", "2024-01"]);
    expect(await getMonthSummaries([])).toEqual([]);
  });
});

describe("GET /api/settlements", () => {
  it("reuses the last summary as focus", async () => {
    const food = await createCategory("餐饮");
    await addTransaction({ categoryId: food.id, date: "2024-06-03", amountCents: 2_500 });
    const response = await getSettlements(new Request(`http://localhost/api/settlements?end=${END}&include=focus`));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.summaries).toHaveLength(6);
    expect(payload.summaries.map((summary: { month: string }) => summary.month)).toEqual(MONTHS);
    expect(payload.focus).toEqual(payload.summaries[5]);
    expect(payload.focus.expenseCents).toBe(2_500);
  });

  it("omits focus unless requested", async () => {
    const payload = await (await getSettlements(new Request(`http://localhost/api/settlements?end=${END}`))).json();
    expect(payload).not.toHaveProperty("focus");
  });
});

describe("getLockedMonths", () => {
  it("agrees with isMonthLocked for settled, reopened and untouched months", async () => {
    await prisma.monthlySettlement.createMany({
      data: [
        { month: monthStart("2024-02"), budgetAmountCents: 0, expenseAmountCents: 0, incomeAmountCents: 0, remainingAmountCents: 0 },
        {
          month: monthStart("2024-03"),
          budgetAmountCents: 0,
          expenseAmountCents: 0,
          incomeAmountCents: 0,
          remainingAmountCents: 0,
          reopenedAt: new Date(),
        },
      ],
    });
    expect(await getLockedMonths(MONTHS)).toEqual(["2024-02"]);
    for (const month of MONTHS) {
      expect(await isMonthLocked(month)).toBe((await getLockedMonths([month])).length === 1);
    }
    expect(await getLockedMonths([])).toEqual([]);
  });
});

describe("POST /api/import", () => {
  function importRequest(rows: unknown[], backup?: Record<string, unknown>) {
    return new Request("http://localhost/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "json", rows, ...(backup ? { backup } : {}) }),
    });
  }

  it("writes a large batch inside one transaction", async () => {
    await createCategory("餐饮");
    const rows = Array.from({ length: 1_500 }, (_, index) => ({
      日期: `2024-05-${String((index % 28) + 1).padStart(2, "0")}`,
      类型: "支出",
      金额: "12.34",
      分类: "餐饮",
      备注: `批量 ${index}`,
    }));
    const response = await importRows(importRequest(rows));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ imported: 1_500 });
    expect(await prisma.transaction.count()).toBe(1_500);
  });

  it("ignores client-supplied ids on a bare row list and inserts instead of overwriting", async () => {
    // Only a full backup envelope may address existing rows by id; a hand-built
    // row list must not be able to overwrite the ledger row of its choosing.
    await createCategory("餐饮");
    const row = { id: "fixed-id-0001", 日期: "2024-05-09", 类型: "支出", 金额: "10.00", 分类: "餐饮", 备注: "首次" };
    expect((await importRows(importRequest([row]))).status).toBe(200);
    const stored = await prisma.transaction.findFirstOrThrow();
    expect(stored.id).not.toBe("fixed-id-0001");

    expect((await importRows(importRequest([{ ...row, 金额: "20.00" }]))).status).toBe(200);
    expect(await prisma.transaction.count()).toBe(2);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: stored.id } })).amountCents).toBe(1_000);
  });

  it("upserts rows by id only inside a backup envelope and keeps createdAt", async () => {
    await createCategory("餐饮");
    const envelope = { version: 1, exportedAt: "2024-06-01T00:00:00.000Z" };
    const row = { id: "fixed-id-0001", 日期: "2024-05-09", 类型: "支出", 金额: "10.00", 分类: "餐饮", 备注: "首次" };
    expect((await importRows(importRequest([row], envelope))).status).toBe(200);
    const first = await prisma.transaction.findUniqueOrThrow({ where: { id: "fixed-id-0001" } });

    expect((await importRows(importRequest([{ ...row, 金额: "20.00", 备注: "改后" }], envelope))).status).toBe(200);
    const second = await prisma.transaction.findUniqueOrThrow({ where: { id: "fixed-id-0001" } });
    expect(await prisma.transaction.count()).toBe(1);
    expect(second.amountCents).toBe(2_000);
    expect(second.note).toBe("改后");
    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
  });

  it("rejects rows pointing at a missing subscription", async () => {
    await createCategory("餐饮");
    const response = await importRows(
      importRequest([
        { 日期: "2024-05-09", 类型: "支出", 金额: "10.00", 分类: "餐饮", source: "SUBSCRIPTION", subscriptionId: "missing-subscription" },
      ]),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("missing-subscription");
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("refuses to import into a settled month", async () => {
    await createCategory("餐饮");
    await prisma.monthlySettlement.create({
      data: { month: monthStart("2024-05"), budgetAmountCents: 0, expenseAmountCents: 0, incomeAmountCents: 0, remainingAmountCents: 0 },
    });
    const response = await importRows(importRequest([{ 日期: "2024-05-09", 类型: "支出", 金额: "10.00", 分类: "餐饮" }]));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("2024-05");
    expect(await prisma.transaction.count()).toBe(0);
  });
});
