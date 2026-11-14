import { TransactionType, type Prisma } from "@prisma/client";
import { monthEnd, calculateRemaining, dateOnlyKey, daysInMonth, monthKey, monthStart, todayInShanghai } from "@/lib/domain";
import { resolveBudget, resolveBudgets, type ResolvedBudget } from "@/lib/budget";
import { prisma } from "@/lib/prisma";
import { serializeSettlement } from "@/lib/serializers";
import { withLedgerRead } from "@/lib/ledger-write";

export async function isMonthLocked(month: string, db: Prisma.TransactionClient = prisma) {
  const settlement = await db.monthlySettlement.findUnique({ where: { month: monthStart(month) }, select: { reopenedAt: true } });
  return Boolean(settlement && !settlement.reopenedAt);
}

/** Batch form of `isMonthLocked`: one query for any number of months. */
export async function getLockedMonths(months: string[], db: Prisma.TransactionClient = prisma): Promise<string[]> {
  const unique = [...new Set(months)];
  if (!unique.length) return [];
  const locked = new Set<string>();
  for (let offset = 0; offset < unique.length; offset += 5_000) {
    const settlements = await db.monthlySettlement.findMany({
      where: { month: { in: unique.slice(offset, offset + 5_000).map(monthStart) }, reopenedAt: null },
      select: { month: true },
    });
    for (const settlement of settlements) locked.add(monthKey(settlement.month));
  }
  return unique.filter((month) => locked.has(month));
}

const SUMMARY_SELECT = {
  occurredOn: true,
  amountCents: true,
  type: true,
  source: true,
  reimbursedAt: true,
  categoryId: true,
  category: { select: { name: true } },
} as const;

type SummaryTransaction = {
  occurredOn: Date;
  amountCents: number;
  type: TransactionType;
  source: string;
  reimbursedAt: Date | null;
  categoryId: string;
  category: { name: string };
};

type SummarySettlement = Parameters<typeof serializeSettlement>[0];

export type SettlementCategorySnapshot = {
  categoryId: string;
  categoryName: string;
  expenseCents: number;
  outOfPocketCents: number;
  incomeCents: number;
};

/** Decode a captured category breakdown; legacy settlements have no snapshot. */
export function settlementCategorySnapshot(value: unknown): SettlementCategorySnapshot[] | null {
  if (!Array.isArray(value)) return null;
  const entries: SettlementCategorySnapshot[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null ||
        !("categoryId" in entry) || typeof entry.categoryId !== "string" ||
        !("categoryName" in entry) || typeof entry.categoryName !== "string" ||
        !("expenseCents" in entry) || typeof entry.expenseCents !== "number" || !Number.isSafeInteger(entry.expenseCents) || entry.expenseCents < 0 ||
        !("outOfPocketCents" in entry) || typeof entry.outOfPocketCents !== "number" || !Number.isSafeInteger(entry.outOfPocketCents) || entry.outOfPocketCents < 0 ||
        !("incomeCents" in entry) || typeof entry.incomeCents !== "number" || !Number.isSafeInteger(entry.incomeCents) || entry.incomeCents < 0) return null;
    entries.push({
      categoryId: entry.categoryId,
      categoryName: entry.categoryName,
      expenseCents: entry.expenseCents,
      outOfPocketCents: entry.outOfPocketCents,
      incomeCents: entry.incomeCents,
    });
  }
  return entries;
}

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
  let outOfPocketCents = 0;
  let reimbursedCents = 0;
  let reimbursedCount = 0;
  let incomeCents = 0;
  let expenseTransactionCount = 0;
  let subscriptionExpenseCents = 0;
  const byCategory = new Map<string, { name: string; amountCents: number }>();
  const byDate = new Map<string, number>();
  const dailyByDate = new Map<string, { expenseCents: number; incomeCents: number; transactionCount: number }>();

  for (const transaction of transactions) {
    const date = dateOnlyKey(transaction.occurredOn);
    const isIncome = transaction.type === TransactionType.INCOME;
    // 报销的支出不占预算：计入 expenseCents（账面支出）但不算进自付，
    // 余额/进度条走 outOfPocket。报销属于“回收”，不是收入。
    const countsTowardBudget = !(transaction.type === TransactionType.EXPENSE && transaction.reimbursedAt);

    if (isIncome) {
      incomeCents += transaction.amountCents;
    } else {
      expenseCents += transaction.amountCents;
      expenseTransactionCount += 1;
      if (transaction.source === "SUBSCRIPTION") subscriptionExpenseCents += transaction.amountCents;
      if (countsTowardBudget) {
        outOfPocketCents += transaction.amountCents;
      } else {
        reimbursedCents += transaction.amountCents;
        reimbursedCount += 1;
      }
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

  const topDate = [...byDate.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const today = todayInShanghai();
  const currentMonth = today.slice(0, 7);
  const elapsedDays = month === currentMonth ? Number(today.slice(8, 10)) : daysInMonth(month);
  const settled = settlement !== null && settlement.reopenedAt === null;
  const capturedCategories = settled && "categorySnapshot" in settlement
    ? settlementCategorySnapshot(settlement.categorySnapshot)
    : null;
  const categoryBreakdown = capturedCategories
    ? capturedCategories.filter((entry) => entry.expenseCents > 0).map((entry) => ({ categoryId: entry.categoryId, categoryName: entry.categoryName, amountCents: entry.expenseCents }))
    : [...byCategory.entries()].map(([categoryId, entry]) => ({ categoryId, categoryName: entry.name, amountCents: entry.amountCents }));
  categoryBreakdown.sort((first, second) => second.amountCents - first.amountCents);
  const topCategory = categoryBreakdown.length ? { name: categoryBreakdown[0].categoryName, amountCents: categoryBreakdown[0].amountCents } : null;
  const budgetCents = settled
    ? settlement.remainingAmountCents === null
      ? null
      : settlement.budgetAmountCents
    : budget.amountCents;
  const reportedExpenseCents = settled ? settlement.expenseAmountCents : expenseCents;
  const reportedIncomeCents = settled ? settlement.incomeAmountCents : incomeCents;
  // A snapshot stores gross expenses but net remaining. Recover its budget
  // consumption without consulting a preset that may have changed since close.
  const reportedOutOfPocketCents = settled
    ? settlement.remainingAmountCents === null
      ? settlement.expenseAmountCents - reimbursedCents
      : settlement.budgetAmountCents - settlement.remainingAmountCents
    : outOfPocketCents;
  const remainingCents = settled ? settlement.remainingAmountCents : calculateRemaining(budgetCents, reportedOutOfPocketCents);
  const dailyBreakdown = Array.from({ length: daysInMonth(month) }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    return { date, ...(dailyByDate.get(date) ?? { expenseCents: 0, incomeCents: 0, transactionCount: 0 }) };
  });

  return {
    month,
    budgetCents,
    budgetSource: settled ? "settlement" as const : budget.source,
    expenseCents: reportedExpenseCents,
    outOfPocketCents: reportedOutOfPocketCents,
    reimbursedCents,
    reimbursedCount,
    incomeCents: reportedIncomeCents,
    remainingCents,
    dailyAverageCents: reportedOutOfPocketCents ? Math.round(reportedOutOfPocketCents / Math.max(1, elapsedDays)) : 0,
    grossDailyAverageCents: reportedExpenseCents ? Math.round(reportedExpenseCents / Math.max(1, elapsedDays)) : 0,
    dailyBreakdown,
    topCategory,
    categoryBreakdown,
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
export async function getMonthSummary(month: string, db?: Prisma.TransactionClient): Promise<MonthSummary> {
  if (!db) return withLedgerRead((tx) => getMonthSummary(month, tx));
  const start = monthStart(month);
  const end = monthEnd(month);

  const [budget, transactions, settlement] = await Promise.all([
    // Must go through resolveBudget: a month with no explicit row still
    // inherits the preset, and settlement snapshots are built from this value.
    resolveBudget(month, db),
    db.transaction.findMany({
      where: { deletedAt: null, occurredOn: { gte: start, lte: end } },
      select: SUMMARY_SELECT,
    }),
    db.monthlySettlement.findUnique({ where: { month: start } }),
  ]);

  return summarizeMonth(month, budget, transactions, settlement);
}

/**
 * Fetch budgets, transactions and snapshots in a bounded set of batch queries.
 * Transactions are read as one span between the earliest and latest month, so
 * callers should pass a contiguous run (the settlements page passes six).
 */
export async function getMonthSummaries(months: string[], db?: Prisma.TransactionClient): Promise<MonthSummary[]> {
  if (!months.length) return [];
  if (!db) return withLedgerRead((tx) => getMonthSummaries(months, tx));
  const starts = months.map(monthStart);
  const times = starts.map((date) => date.getTime());
  const rangeStart = new Date(Math.min(...times));
  const rangeEnd = monthEnd(monthKey(new Date(Math.max(...times))));

  const [budgets, transactions, settlements] = await Promise.all([
    resolveBudgets(months, db),
    db.transaction.findMany({
      where: { deletedAt: null, occurredOn: { gte: rangeStart, lte: rangeEnd } },
      select: SUMMARY_SELECT,
    }),
    db.monthlySettlement.findMany({ where: { month: { in: starts } } }),
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
