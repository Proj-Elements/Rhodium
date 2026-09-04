import { NextResponse } from "next/server";
import { TransactionType } from "@prisma/client";
import { calculateRemaining, calculateUsage, dateOnlyKey, daysInMonth, parseMonth, todayInShanghai } from "@/lib/domain";
import { handleApiError, monthRange } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { serializeTransaction } from "@/lib/serializers";
import { syncSubscriptions } from "@/lib/subscriptions";
import { resolveMonthBudget } from "@/lib/budget";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") || todayInShanghai().slice(0, 7);
    parseMonth(month);
    // Subscription charges belong to this month's totals, so they must exist
    // before we aggregate. The call is cooldown-cached, so a warm process does
    // no write here.
    await syncSubscriptions();

    const { start, nextStart } = monthRange(month);
    const today = todayInShanghai();
    const currentMonth = today.slice(0, 7);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const monthStatus: "past" | "current" | "future" = month < currentMonth ? "past" : month > currentMonth ? "future" : "current";
    const focusDate = monthStatus === "current" ? todayDate : monthStatus === "past" ? monthRange(month).end : start;
    const recentStart = new Date(focusDate);
    recentStart.setUTCDate(recentStart.getUTCDate() - 6);
    const chartStart = month === currentMonth || recentStart >= start ? recentStart : start;
    const chartDayCount = Math.floor((focusDate.getTime() - chartStart.getTime()) / 86_400_000) + 1;

    const monthTxWhere = { deletedAt: null as null, occurredOn: { gte: start, lt: nextStart } };
    const [budget, expense, income, focusGroups, transactions, grouped, transactionCount, expenseTransactionCount, recentExpenseGroups, recentIncomeGroups] = await Promise.all([
      resolveMonthBudget(month),
      prisma.transaction.aggregate({
        where: { ...monthTxWhere, type: TransactionType.EXPENSE },
        _sum: { amountCents: true },
      }),
      prisma.transaction.aggregate({
        where: { ...monthTxWhere, type: TransactionType.INCOME },
        _sum: { amountCents: true },
      }),
      // One grouped query for focus-date expense+income (was two aggregates).
      prisma.transaction.groupBy({
        by: ["occurredOn", "type"],
        where: { deletedAt: null, occurredOn: { equals: focusDate } },
        _sum: { amountCents: true },
      }),
      prisma.transaction.findMany({
        where: monthTxWhere,
        include: { category: true, subscription: { select: { name: true } } },
        orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
        take: 10,
      }),
      // Grouping by category through the relation avoids the follow-up
      // category.findMany that used to run after this batch.
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { ...monthTxWhere, type: TransactionType.EXPENSE },
        _sum: { amountCents: true },
        orderBy: { _sum: { amountCents: "desc" } },
      }),
      prisma.transaction.count({ where: monthTxWhere }),
      prisma.transaction.count({ where: { ...monthTxWhere, type: TransactionType.EXPENSE } }),
      prisma.transaction.groupBy({
        by: ["occurredOn"],
        where: { type: TransactionType.EXPENSE, deletedAt: null, occurredOn: { gte: chartStart, lte: focusDate } },
        _sum: { amountCents: true },
      }),
      prisma.transaction.groupBy({
        by: ["occurredOn"],
        where: { type: TransactionType.INCOME, deletedAt: null, occurredOn: { gte: chartStart, lte: focusDate } },
        _sum: { amountCents: true },
      }),
    ]);

    // The 10 recent transactions already carry their categories; only ids that
    // are not among them need a lookup, which is usually none.
    const categoryMap = new Map(transactions.map((item) => [item.categoryId, item.category.name]));
    const missingCategoryIds = grouped.map((item) => item.categoryId).filter((id) => !categoryMap.has(id));
    if (missingCategoryIds.length) {
      const categories = await prisma.category.findMany({ where: { id: { in: missingCategoryIds } }, select: { id: true, name: true } });
      for (const category of categories) categoryMap.set(category.id, category.name);
    }

    const expenseByDate = new Map(recentExpenseGroups.map((item) => [dateOnlyKey(item.occurredOn), item._sum.amountCents ?? 0]));
    const incomeByDate = new Map(recentIncomeGroups.map((item) => [dateOnlyKey(item.occurredOn), item._sum.amountCents ?? 0]));
    const recentExpenses = Array.from({ length: Math.max(chartDayCount, 1) }, (_, index) => {
      const date = new Date(chartStart);
      date.setUTCDate(date.getUTCDate() + index);
      const dateKey = dateOnlyKey(date);
      return { date: dateKey, amountCents: expenseByDate.get(dateKey) ?? 0, incomeCents: incomeByDate.get(dateKey) ?? 0 };
    });

    const focusDateExpenseCents = focusGroups.find((group) => group.type === TransactionType.EXPENSE)?._sum.amountCents ?? 0;
    const focusDateIncomeCents = focusGroups.find((group) => group.type === TransactionType.INCOME)?._sum.amountCents ?? 0;
    const expenseCents = expense._sum.amountCents ?? 0;
    const budgetCents = budget.amountCents;
    return NextResponse.json({
      month,
      today,
      focusDate: dateOnlyKey(focusDate),
      budget: budgetCents === null ? null : { amountCents: budgetCents },
      budgetSource: budget.source,
      expenseCents,
      incomeCents: income._sum.amountCents ?? 0,
      remainingCents: calculateRemaining(budgetCents, expenseCents),
      usagePercent: calculateUsage(budgetCents, expenseCents),
      focusDateExpenseCents,
      focusDateIncomeCents,
      transactionCount,
      expenseTransactionCount,
      monthStatus,
      daysElapsed: monthStatus === "current" ? Number(today.slice(8, 10)) : monthStatus === "past" ? daysInMonth(month) : 0,
      daysInMonth: daysInMonth(month),
      categoryBreakdown: grouped.map((item) => ({
        categoryId: item.categoryId,
        categoryName: categoryMap.get(item.categoryId) || "其他",
        amountCents: item._sum.amountCents ?? 0,
      })),
      recentExpenses,
      recentTransactions: transactions.map(serializeTransaction),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
