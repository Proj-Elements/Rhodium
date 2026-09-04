import { TransactionType } from "@prisma/client";
import { dateOnlyKey, daysInMonth, monthStart, todayInShanghai } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { resolveMonthBudget, type BudgetSource } from "@/lib/budget";
import { serializeSettlement } from "@/lib/serializers";

export async function isMonthLocked(month: string) {
  const settlement = await prisma.monthlySettlement.findUnique({ where: { month: monthStart(month) }, select: { reopenedAt: true } });
  return Boolean(settlement && !settlement.reopenedAt);
}

/**
 * One transactions fetch feeds expense totals, category breakdown, top-date and
 * the daily calendar (previously the month was fetched twice).
 *
 * The budget resolves through `resolveMonthBudget`, so a month covered only by
 * the BudgetPreset reports its effective budget here too — the monthly review
 * and the settlement snapshot used to read `null` and persist 0.
 */
export async function getMonthSummary(month: string) {
  const start = monthStart(month);
  const nextStart = new Date(start);
  nextStart.setUTCMonth(nextStart.getUTCMonth() + 1);

  const [budget, transactions, settlement] = await Promise.all([
    resolveMonthBudget(month),
    prisma.transaction.findMany({
      where: { deletedAt: null, occurredOn: { gte: start, lt: nextStart } },
      select: { occurredOn: true, amountCents: true, type: true, source: true, categoryId: true, category: { select: { name: true } } },
    }),
    prisma.monthlySettlement.findUnique({ where: { month: start } }),
  ]);

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
    budgetSource: budget.source satisfies BudgetSource,
    expenseCents,
    incomeCents,
    remainingCents: budget.amountCents === null ? null : budget.amountCents - expenseCents,
    dailyAverageCents: expenseTransactionCount ? Math.round(expenseCents / Math.max(1, elapsedDays)) : 0,
    dailyBreakdown,
    topCategory,
    topDate: topDate ? { date: topDate[0], amountCents: topDate[1] } : null,
    subscriptionExpenseCents,
    transactionCount: transactions.length,
    settlement: settlement ? serializeSettlement(settlement) : null,
  };
}
