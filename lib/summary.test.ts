import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * `resolveBudget` is the single entry point for a month's effective budget, and
 * `getMonthSummary` feeds both the monthly review and the settlement snapshot. Before
 * the fix, the summary read `prisma.monthlyBudget` directly and reported "no budget"
 * for months covered only by the preset — the settlement then froze that as 0 forever.
 * Prisma is mocked so the aggregation and the budget fallback can be asserted without
 * a database.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monthlyBudget: { findUnique: vi.fn() },
    budgetPreset: { findUnique: vi.fn() },
    transaction: { findMany: vi.fn() },
    monthlySettlement: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

const { prisma } = await import("@/lib/prisma");
const { resolveBudget } = await import("@/lib/budget");
const { getMonthSummary } = await import("@/lib/summary");

// Plain Mock handles: the production code reads narrow `select` projections, so the
// fixtures below are deliberately partial and would not satisfy Prisma's full row types.
const monthlyBudget = prisma.monthlyBudget.findUnique as unknown as Mock;
const budgetPreset = prisma.budgetPreset.findUnique as unknown as Mock;
const findTransactions = prisma.transaction.findMany as unknown as Mock;
const findSettlement = prisma.monthlySettlement.findUnique as unknown as Mock;
const readTransaction = prisma.$transaction as unknown as Mock;

// A closed month keeps `dailyAverageCents` independent of the current date.
const MONTH = "2024-01";

type Row = {
  occurredOn: Date;
  amountCents: number;
  type: "EXPENSE" | "INCOME";
  source: "MANUAL" | "SUBSCRIPTION";
  reimbursedAt: Date | null;
  categoryId: string;
  category: { name: string };
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    occurredOn: new Date("2024-01-05T00:00:00.000Z"),
    amountCents: 1000,
    type: "EXPENSE",
    source: "MANUAL",
    reimbursedAt: null,
    categoryId: "cat_food",
    category: { name: "餐饮" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  monthlyBudget.mockResolvedValue(null);
  budgetPreset.mockResolvedValue(null);
  findTransactions.mockResolvedValue([]);
  findSettlement.mockResolvedValue(null);
  readTransaction.mockImplementation(async (work) => work(prisma));
  vi.mocked(prisma.$executeRaw).mockResolvedValue(0);
});

describe("resolveBudget", () => {
  it("prefers the explicit month row over the preset", async () => {
    monthlyBudget.mockResolvedValue({ amountCents: 300_000 });
    budgetPreset.mockResolvedValue({ id: 1, amountCents: 200_000 });
    await expect(resolveBudget(MONTH)).resolves.toEqual({ amountCents: 300_000, source: "month" });
  });

  it("falls back to the preset when the month has no explicit budget", async () => {
    budgetPreset.mockResolvedValue({ id: 1, amountCents: 200_000 });
    await expect(resolveBudget(MONTH)).resolves.toEqual({ amountCents: 200_000, source: "preset" });
  });

  it("reports no budget when neither exists", async () => {
    await expect(resolveBudget(MONTH)).resolves.toEqual({ amountCents: null, source: "none" });
  });

  it("treats a zero preset as a real budget rather than as missing", async () => {
    budgetPreset.mockResolvedValue({ id: 1, amountCents: 0 });
    await expect(resolveBudget(MONTH)).resolves.toEqual({ amountCents: 0, source: "preset" });
  });

  it("uses the captured budget once a month is settled", async () => {
    monthlyBudget.mockResolvedValue({ amountCents: 300_000 });
    budgetPreset.mockResolvedValue({ amountCents: 400_000 });
    findSettlement.mockResolvedValue({ reopenedAt: null, remainingAmountCents: 120_000, budgetAmountCents: 200_000 });

    await expect(resolveBudget(MONTH)).resolves.toEqual({ amountCents: 200_000, source: "settlement" });
  });

  it("preserves an unset budget captured by settlement", async () => {
    budgetPreset.mockResolvedValue({ amountCents: 400_000 });
    findSettlement.mockResolvedValue({ reopenedAt: null, remainingAmountCents: null, budgetAmountCents: 0 });

    await expect(resolveBudget(MONTH)).resolves.toEqual({ amountCents: null, source: "settlement" });
  });
});

describe("getMonthSummary", () => {
  it("resolves a preset-only month to its effective budget and remaining amount", async () => {
    budgetPreset.mockResolvedValue({ id: 1, amountCents: 200_000 });
    findTransactions.mockResolvedValue([row({ amountCents: 50_000 })]);

    const summary = await getMonthSummary(MONTH);

    expect(summary.budgetCents).toBe(200_000);
    expect(summary.budgetSource).toBe("preset");
    expect(summary.remainingCents).toBe(150_000);
  });

  it("leaves budget and remaining null when no budget is configured", async () => {
    findTransactions.mockResolvedValue([row()]);

    const summary = await getMonthSummary(MONTH);

    expect(summary.budgetCents).toBeNull();
    expect(summary.budgetSource).toBe("none");
    expect(summary.remainingCents).toBeNull();
  });

  it("uses the captured amounts for a settled month instead of the current preset", async () => {
    budgetPreset.mockResolvedValue({ id: 1, amountCents: 300_000 });
    findTransactions.mockResolvedValue([row({ amountCents: 70_000, type: "EXPENSE" }), row({ amountCents: 10_000, type: "INCOME" })]);
    findSettlement.mockResolvedValue({
      id: "settlement-1",
      month: new Date("2024-01-01T00:00:00.000Z"),
      budgetAmountCents: 200_000,
      expenseAmountCents: 50_000,
      incomeAmountCents: 5_000,
      remainingAmountCents: 150_000,
      settledAt: new Date("2024-02-01T00:00:00.000Z"),
      reopenedAt: null,
    });

    const summary = await getMonthSummary(MONTH);

    expect(summary).toMatchObject({
      budgetCents: 200_000,
      budgetSource: "settlement",
      expenseCents: 50_000,
      incomeCents: 5_000,
      remainingCents: 150_000,
      settlement: { budgetAmountCents: 200_000, expenseAmountCents: 50_000, incomeAmountCents: 5_000 },
    });
  });

  it("returns live values after a settlement has been reopened", async () => {
    budgetPreset.mockResolvedValue({ id: 1, amountCents: 300_000 });
    findTransactions.mockResolvedValue([row({ amountCents: 70_000 })]);
    findSettlement.mockResolvedValue({
      id: "settlement-1",
      month: new Date("2024-01-01T00:00:00.000Z"),
      budgetAmountCents: 200_000,
      expenseAmountCents: 50_000,
      incomeAmountCents: 5_000,
      remainingAmountCents: 150_000,
      settledAt: new Date("2024-02-01T00:00:00.000Z"),
      reopenedAt: new Date("2024-02-02T00:00:00.000Z"),
    });

    const summary = await getMonthSummary(MONTH);

    expect(summary).toMatchObject({ budgetCents: 300_000, expenseCents: 70_000, remainingCents: 230_000 });
  });

  it("keeps the captured category names and amounts after a category is renamed", async () => {
    findTransactions.mockResolvedValue([row({ amountCents: 5000, category: { name: "改名后的分类" } })]);
    findSettlement.mockResolvedValue({
      id: "settlement-1",
      month: new Date("2024-01-01T00:00:00.000Z"),
      budgetAmountCents: 20_000,
      expenseAmountCents: 5000,
      incomeAmountCents: 0,
      remainingAmountCents: 15_000,
      settledAt: new Date("2024-02-01T00:00:00.000Z"),
      reopenedAt: null,
      categorySnapshot: [{ categoryId: "cat_food", categoryName: "原始分类", expenseCents: 5000, outOfPocketCents: 5000, incomeCents: 0 }],
    });

    const summary = await getMonthSummary(MONTH);

    expect(summary.topCategory).toEqual({ name: "原始分类", amountCents: 5000 });
    expect(summary.categoryBreakdown).toEqual([{ categoryId: "cat_food", categoryName: "原始分类", amountCents: 5000 }]);
  });

  it("queries DATE columns through the inclusive final day of the month", async () => {
    await getMonthSummary(MONTH);

    const where = findTransactions.mock.calls[0][0]?.where as { occurredOn: { gte: Date; lte: Date }; deletedAt: null };
    expect(where.deletedAt).toBeNull();
    expect(where.occurredOn.gte.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(where.occurredOn.lte.toISOString()).toBe("2024-01-31T00:00:00.000Z");
  });

  it("keeps income out of expense totals, categories and top-date", async () => {
    findTransactions.mockResolvedValue([
      row({ amountCents: 30_000 }),
      row({ amountCents: 12_000, type: "INCOME", categoryId: "cat_salary", category: { name: "工资" } }),
    ]);

    const summary = await getMonthSummary(MONTH);

    expect(summary.expenseCents).toBe(30_000);
    expect(summary.incomeCents).toBe(12_000);
    expect(summary.transactionCount).toBe(2);
    // The review's "N 笔支出" card must count expenses only, not all rows.
    expect(summary.expenseTransactionCount).toBe(1);
    expect(summary.topCategory).toEqual({ name: "餐饮", amountCents: 30_000 });
    expect(summary.topDate).toEqual({ date: "2024-01-05", amountCents: 30_000 });
  });

  it("tracks subscription expenses separately and ranks categories by amount", async () => {
    findTransactions.mockResolvedValue([
      row({ amountCents: 4_000 }),
      row({ amountCents: 9_900, source: "SUBSCRIPTION", categoryId: "cat_sub", category: { name: "订阅" } }),
    ]);

    const summary = await getMonthSummary(MONTH);

    expect(summary.subscriptionExpenseCents).toBe(9_900);
    expect(summary.topCategory).toEqual({ name: "订阅", amountCents: 9_900 });
  });

  it("keeps reimbursed expenses in the ledger but out of the budget math", async () => {
    findTransactions.mockResolvedValue([
      row({ amountCents: 30_000 }),
      row({ amountCents: 12_000, reimbursedAt: new Date("2024-01-20T00:00:00.000Z") }),
      row({ amountCents: 5_000, type: "INCOME", categoryId: "cat_salary", category: { name: "工资" } }),
    ]);

    const summary = await getMonthSummary(MONTH);

    // 账面支出包含报销，预算口径只算自付。
    expect(summary.expenseCents).toBe(42_000);
    expect(summary.outOfPocketCents).toBe(30_000);
    expect(summary.reimbursedCents).toBe(12_000);
    expect(summary.reimbursedCount).toBe(1);
    // 报销属于回收，绝不计入收入。
    expect(summary.incomeCents).toBe(5_000);
    // 分类排行与单日峰值仍按全额支出排序。
    expect(summary.topCategory).toEqual({ name: "餐饮", amountCents: 42_000 });
    expect(summary.topDate).toEqual({ date: "2024-01-05", amountCents: 42_000 });
  });

  it("computes remaining and daily average from out-of-pocket amounts only", async () => {
    budgetPreset.mockResolvedValue({ id: 1, amountCents: 20_000 });
    findTransactions.mockResolvedValue([
      row({ amountCents: 15_000 }),
      row({ amountCents: 12_000, reimbursedAt: new Date("2024-01-20T00:00:00.000Z") }),
    ]);

    const summary = await getMonthSummary(MONTH);

    expect(summary.remainingCents).toBe(5_000);
    // 一月有 31 天：15000 / 31 ≈ 484。
    expect(summary.dailyAverageCents).toBe(484);
    expect(summary.grossDailyAverageCents).toBe(871);
  });

  it("reads all summary components in one repeatable-read transaction", async () => {
    await getMonthSummary(MONTH);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "RepeatableRead" }));
  });

  it("reports zeros without any reimbursement", async () => {
    findTransactions.mockResolvedValue([row({ amountCents: 30_000 })]);

    const summary = await getMonthSummary(MONTH);

    expect(summary.reimbursedCents).toBe(0);
    expect(summary.reimbursedCount).toBe(0);
    expect(summary.outOfPocketCents).toBe(30_000);
  });

  it("returns one calendar entry per day with only the active days filled in", async () => {
    findTransactions.mockResolvedValue([
      row({ amountCents: 2_500, occurredOn: new Date("2024-01-31T00:00:00.000Z") }),
      row({ amountCents: 700, type: "INCOME", occurredOn: new Date("2024-01-31T00:00:00.000Z") }),
    ]);

    const summary = await getMonthSummary(MONTH);

    expect(summary.dailyBreakdown).toHaveLength(31);
    expect(summary.dailyBreakdown[0]).toEqual({ date: "2024-01-01", expenseCents: 0, incomeCents: 0, transactionCount: 0 });
    expect(summary.dailyBreakdown[30]).toEqual({ date: "2024-01-31", expenseCents: 2_500, incomeCents: 700, transactionCount: 2 });
  });

  it("averages expenses over the whole month for a past month, and reports 0 without expenses", async () => {
    findTransactions.mockResolvedValue([row({ amountCents: 31_000 })]);
    await expect(getMonthSummary(MONTH)).resolves.toMatchObject({ dailyAverageCents: 1_000 });

    findTransactions.mockResolvedValue([row({ amountCents: 5_000, type: "INCOME" })]);
    await expect(getMonthSummary(MONTH)).resolves.toMatchObject({ dailyAverageCents: 0 });
  });
});
