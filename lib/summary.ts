import { TransactionType } from "@prisma/client";
import { daysInMonth, monthEnd, monthStart, todayInShanghai } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

export async function isMonthLocked(month: string) {
  const settlement = await prisma.monthlySettlement.findUnique({ where: { month: monthStart(month) }, select: { reopenedAt: true } });
  return Boolean(settlement && !settlement.reopenedAt);
}

export async function getMonthSummary(month: string) {
  const start = monthStart(month);
  const end = monthEnd(month);
  const nextStart = new Date(end);
  nextStart.setUTCDate(nextStart.getUTCDate() + 1);
  const [budget, expenses, income, transactions, dailyTransactions, settlement] = await Promise.all([
    prisma.monthlyBudget.findUnique({ where: { month: start } }),
    prisma.transaction.aggregate({
      where: { type: TransactionType.EXPENSE, deletedAt: null, occurredOn: { gte: start, lt: nextStart } },
      _sum: { amountCents: true },
    }),
    prisma.transaction.aggregate({
      where: { type: TransactionType.INCOME, deletedAt: null, occurredOn: { gte: start, lt: nextStart } },
      _sum: { amountCents: true },
    }),
    prisma.transaction.findMany({
      where: { type: TransactionType.EXPENSE, deletedAt: null, occurredOn: { gte: start, lt: nextStart } },
      include: { category: true },
      orderBy: { amountCents: "desc" },
    }),
    prisma.transaction.findMany({
      where: { deletedAt: null, occurredOn: { gte: start, lt: nextStart } },
      select: { occurredOn: true, amountCents: true, type: true },
    }),
    prisma.monthlySettlement.findUnique({ where: { month: start } }),
  ]);
  const expenseCents = expenses._sum.amountCents ?? 0;
  const incomeCents = income._sum.amountCents ?? 0;
  const byCategory = new Map<string, { name: string; amountCents: number }>();
  const byDate = new Map<string, number>();
  for (const transaction of transactions) {
    const category = byCategory.get(transaction.categoryId) ?? { name: transaction.category.name, amountCents: 0 };
    category.amountCents += transaction.amountCents;
    byCategory.set(transaction.categoryId, category);
    const date = transaction.occurredOn.toISOString().slice(0, 10);
    byDate.set(date, (byDate.get(date) ?? 0) + transaction.amountCents);
  }
  const dailyByDate = new Map<string, { expenseCents: number; incomeCents: number; transactionCount: number }>();
  for (const transaction of dailyTransactions) {
    const date = transaction.occurredOn.toISOString().slice(0, 10);
    const daily = dailyByDate.get(date) ?? { expenseCents: 0, incomeCents: 0, transactionCount: 0 };
    daily.transactionCount += 1;
    if (transaction.type === TransactionType.INCOME) daily.incomeCents += transaction.amountCents;
    else daily.expenseCents += transaction.amountCents;
    dailyByDate.set(date, daily);
  }
  const topCategory = [...byCategory.values()].sort((a, b) => b.amountCents - a.amountCents)[0] ?? null;
  const topDate = [...byDate.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const subscriptionExpenseCents = transactions.filter((transaction) => transaction.source === "SUBSCRIPTION").reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const currentMonth = todayInShanghai().slice(0, 7);
  const elapsedDays = month === currentMonth ? Number(todayInShanghai().slice(8, 10)) : daysInMonth(month);
  const dailyBreakdown = Array.from({ length: daysInMonth(month) }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    return { date, ...(dailyByDate.get(date) ?? { expenseCents: 0, incomeCents: 0, transactionCount: 0 }) };
  });
  return {
    month,
    budgetCents: budget?.amountCents ?? null,
    expenseCents,
    incomeCents,
    remainingCents: budget ? budget.amountCents - expenseCents : null,
    dailyAverageCents: transactions.length ? Math.round(expenseCents / Math.max(1, elapsedDays)) : 0,
    dailyBreakdown,
    topCategory,
    topDate: topDate ? { date: topDate[0], amountCents: topDate[1] } : null,
    subscriptionExpenseCents,
    transactionCount: transactions.length,
    settlement: settlement ? { ...settlement, month } : null,
  };
}
