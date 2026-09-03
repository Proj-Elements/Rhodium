import { NextResponse } from "next/server";
import { TransactionType } from "@prisma/client";
import { calculateRemaining, calculateUsage, dateOnlyKey, daysInMonth, parseMonth, todayInShanghai } from "@/lib/domain";
import { handleApiError, monthRange } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCategories } from "@/lib/seed";
import { serializeTransaction } from "@/lib/serializers";
import { syncSubscriptions } from "@/lib/subscriptions";
import { getBudgetPreset, hasExplicitBudget } from "@/lib/budget";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") || todayInShanghai().slice(0, 7);
    parseMonth(month);
    await ensureDefaultCategories();
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
    const [preset, hasExplicit, expense, income, focusGroups, transactions, grouped, transactionCount, expenseTransactionCount, recentExpenseGroups, recentIncomeGroups] = await Promise.all([
      getBudgetPreset(),
      hasExplicitBudget(month),
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

    const categoryIds = grouped.map((item) => item.categoryId);
    const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } } });
    const categoryMap = new Map(categories.map((category) => [category.id, category.name]));

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
    // Effective budget = explicit month row, falling back to the preset.
    const budgetCents = hasExplicit ? await prisma.monthlyBudget.findUnique({ where: { month: start }, select: { amountCents: true } }).then((row) => row?.amountCents ?? null) : preset;
    return NextResponse.json({
      month,
      today,
      focusDate: dateOnlyKey(focusDate),
      budget: budgetCents === null ? null : { amountCents: budgetCents },
      budgetSource: budgetCents === null ? "none" : hasExplicit ? "month" : "preset",
      expenseCents,
      incomeCents: income._sum.amountCents ?? 0,
      remainingCents: calculateRemaining(budgetCents, expenseCents),
      usagePercent: calculateUsage(budgetCents, expenseCents),
      todayExpenseCents: focusDateExpenseCents,
      todayIncomeCents: focusDateIncomeCents,
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
