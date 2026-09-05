import { TransactionType } from "@prisma/client";
import { calculateRemaining, dateOnlyKey, daysInMonth, monthKey, monthStart, todayInShanghai } from "@/lib/domain";
import { resolveBudget, resolveBudgets, type ResolvedBudget } from "@/lib/budget";
import { prisma } from "@/lib/prisma";
import { serializeSettlement } from "@/lib/serializers";

export async function isMonthLocked(month: string) {
  const settlement = await prisma.monthlySettlement.findUnique({ where: { month: monthStart(month) }, select: { reopenedAt: true } });
  return Boolean(settlement && !settlement.reopenedAt);
}

/** Batch form of `isMonthLocked`: one query for any number of months. */
export async function getLockedMonths(months: string[]): Promise<string[]> {
  const unique = [...new Set(months)];
  if (!unique.length) return [];
  const settlements = await prisma.monthlySettlement.findMany({
    where: { month: { in: unique.map(monthStart) }, reopenedAt: null },
    select: { month: true },
  });
  const locked = new Set(settlements.map((settlement) => monthKey(settlement.month)));
  return unique.filter((month) => locked.has(month));
}

const SUMMARY_SELECT = {
  occurredOn: true,
  amountCents: true,
  type: true,
  source: true,
  categoryId: true,
  category: { select: { name: true } },
} as const;

type SummaryTransaction = {
  occurredOn: Date;
  amountCents: number;
  type: TransactionType;
  source: string;
  categoryId: string;
  category: { name: string };
};

type SummarySettlement = Parameters<typeof serializeSettlement>[0];

/**
 * Pure fold over one month's rows. Kept separate from fetching so a single
 * month and a batch of months share exactly the same aggregation logic.
 */
function summarizeMonth(
  month: string,
  budget: ResolvedBudget,
  transactions: SummaryTransaction[],
  settlement: SummarySettlement | null,
) {
  let expenseCents = 0;
  let incomeCents = 0;
  let expenseTransactionCount = 0;
  let subscriptionExpenseCents = 0;
  const byCategory = new Map<string, { name: string; amountCents: number }>();
  const byDate = new Map<string, number>();
  const dailyByDate = new Map<string, { expenseCents: number; incomeCents: number; transactionCount: number }>();

  for (const transaction of transactions) {
    const date = dateOnlyKey(transaction.occurredOn);
    const isIncome = transaction.type === TransactionType.INCOME;

    if (isIncome) {
      incomeCents += transaction.amountCents;
    } else {
      expenseCents += transaction.amountCents;
      expenseTransactionCount += 1;
      if (transaction.source === "SUBSCRIPTION") subscriptionExpenseCents += transaction.amountCents;
      const category = byCategory.get(transaction.categoryId) ?? { name: transaction.category.name, amountCents: 0 };
      category.amountCents += transaction.amountCents;
      byCategory.set(transaction.categoryId, category);
      byDate.set(date, (byDate.get(date) ?? 0) + transaction.amountCents);
    }

    const daily = dailyByDate.get(date) ?? { expenseCents: 0, incomeCents: 0, transactionCount: 0 };
    daily.transactionCount += 1;
    if (isIncome) daily.incomeCents += transaction.amountCents;
    else daily.expenseCents += transaction.amountCents;
    dailyByDate.set(date, daily);
  }

  const topCategory = [...byCategory.values()].sort((a, b) => b.amountCents - a.amountCents)[0] ?? null;
  const topDate = [...byDate.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const today = todayInShanghai();
  const currentMonth = today.slice(0, 7);
  const elapsedDays = month === currentMonth ? Number(today.slice(8, 10)) : daysInMonth(month);
  const dailyBreakdown = Array.from({ length: daysInMonth(month) }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    return { date, ...(dailyByDate.get(date) ?? { expenseCents: 0, incomeCents: 0, transactionCount: 0 }) };
  });

  return {
    month,
    budgetCents: budget.amountCents,
    budgetSource: budget.source,
    expenseCents,
    incomeCents,
    remainingCents: calculateRemaining(budget.amountCents, expenseCents),
    dailyAverageCents: expenseTransactionCount ? Math.round(expenseCents / Math.max(1, elapsedDays)) : 0,
    dailyBreakdown,
    topCategory,
    topDate: topDate ? { date: topDate[0], amountCents: topDate[1] } : null,
    subscriptionExpenseCents,
    transactionCount: transactions.length,
    expenseTransactionCount,
    settlement: settlement ? serializeSettlement(settlement) : null,
  };
}

export type MonthSummary = ReturnType<typeof summarizeMonth>;

/**
 * One transactions fetch feeds expense totals, category breakdown, top-date and
 * the daily calendar (previously the month was fetched twice).
 */
export async function getMonthSummary(month: string): Promise<MonthSummary> {
  const start = monthStart(month);
  const nextStart = new Date(start);
  nextStart.setUTCMonth(nextStart.getUTCMonth() + 1);

  const [budget, transactions, settlement] = await Promise.all([
    // Must go through resolveBudget: a month with no explicit row still
    // inherits the preset, and settlement snapshots are built from this value.
    resolveBudget(month),
    prisma.transaction.findMany({
      where: { deletedAt: null, occurredOn: { gte: start, lt: nextStart } },
      select: SUMMARY_SELECT,
    }),
    prisma.monthlySettlement.findUnique({ where: { month: start } }),
  ]);

  return summarizeMonth(month, budget, transactions, settlement);
}

/**
 * Summaries for several months in three queries instead of four per month.
 * Transactions are read as one span between the earliest and latest month, so
 * callers should pass a contiguous run (the settlements page passes six).
 */
export async function getMonthSummaries(months: string[]): Promise<MonthSummary[]> {
  if (!months.length) return [];
  const starts = months.map(monthStart);
  const times = starts.map((date) => date.getTime());
  const rangeStart = new Date(Math.min(...times));
  const rangeEnd = new Date(Math.max(...times));
  rangeEnd.setUTCMonth(rangeEnd.getUTCMonth() + 1);

  const [budgets, transactions, settlements] = await Promise.all([
    resolveBudgets(months),
    prisma.transaction.findMany({
      where: { deletedAt: null, occurredOn: { gte: rangeStart, lt: rangeEnd } },
      select: SUMMARY_SELECT,
    }),
    prisma.monthlySettlement.findMany({ where: { month: { in: starts } } }),
  ]);

  const byMonth = new Map<string, SummaryTransaction[]>();
  for (const transaction of transactions) {
    const key = monthKey(transaction.occurredOn);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(transaction);
    else byMonth.set(key, [transaction]);
  }
  const settlementByMonth = new Map(settlements.map((settlement) => [monthKey(settlement.month), settlement]));

  return months.map((month) =>
    summarizeMonth(month, budgets.get(month) ?? { amountCents: null, source: "none" }, byMonth.get(month) ?? [], settlementByMonth.get(month) ?? null),
  );
}
