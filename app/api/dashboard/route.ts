import { NextResponse } from "next/server";
import { TransactionType } from "@prisma/client";
import { calculateRemaining, calculateUsage, dateOnlyKey, daysInMonth, monthEnd, monthStart, parseMonth, todayInShanghai } from "@/lib/domain";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCategories } from "@/lib/seed";
import { serializeTransaction } from "@/lib/serializers";
import { syncSubscriptions } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") || todayInShanghai().slice(0, 7);
    parseMonth(month);
    await ensureDefaultCategories();
    await syncSubscriptions();

    const start = monthStart(month);
    const end = monthEnd(month);
    const nextStart = new Date(end);
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
    const today = todayInShanghai();
    const currentMonth = today.slice(0, 7);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const monthStatus: "past" | "current" | "future" = month < currentMonth ? "past" : month > currentMonth ? "future" : "current";
    const focusDate = monthStatus === "current" ? todayDate : monthStatus === "past" ? end : start;
    const recentStart = new Date(focusDate);
    recentStart.setUTCDate(recentStart.getUTCDate() - 6);
    const chartStart = month === currentMonth || recentStart >= start ? recentStart : start;
    const chartDayCount = Math.floor((focusDate.getTime() - chartStart.getTime()) / 86_400_000) + 1;

    const [budget, expense, income, focusExpense, focusIncome, transactions, grouped, transactionCount, expenseTransactionCount, recentExpenseGroups, recentIncomeGroups] = await Promise.all([
      prisma.monthlyBudget.findUnique({ where: { month: start } }),
      prisma.transaction.aggregate({
        where: { type: TransactionType.EXPENSE, deletedAt: null, occurredOn: { gte: start, lt: nextStart } },
        _sum: { amountCents: true },
      }),
      prisma.transaction.aggregate({
        where: { type: TransactionType.INCOME, deletedAt: null, occurredOn: { gte: start, lt: nextStart } },
        _sum: { amountCents: true },
      }),
      prisma.transaction.aggregate({
        where: { type: TransactionType.EXPENSE, deletedAt: null, occurredOn: { equals: focusDate } },
        _sum: { amountCents: true },
      }),
      prisma.transaction.aggregate({
        where: { type: TransactionType.INCOME, deletedAt: null, occurredOn: { equals: focusDate } },
        _sum: { amountCents: true },
      }),
      prisma.transaction.findMany({
        where: { deletedAt: null, occurredOn: { gte: start, lt: nextStart } },
        include: { category: true, subscription: { select: { name: true } } },
        orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
        take: 10,
      }),
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { type: TransactionType.EXPENSE, deletedAt: null, occurredOn: { gte: start, lt: nextStart } },
        _sum: { amountCents: true },
        orderBy: { _sum: { amountCents: "desc" } },
      }),
      prisma.transaction.count({ where: { deletedAt: null, occurredOn: { gte: start, lt: nextStart } } }),
      prisma.transaction.count({ where: { type: TransactionType.EXPENSE, deletedAt: null, occurredOn: { gte: start, lt: nextStart } } }),
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

    const expenseCents = expense._sum.amountCents ?? 0;
    const budgetCents = budget?.amountCents ?? null;
    const focusDateExpenseCents = focusExpense._sum.amountCents ?? 0;
    const focusDateIncomeCents = focusIncome._sum.amountCents ?? 0;
    return NextResponse.json({
      month,
      today,
      focusDate: dateOnlyKey(focusDate),
      budget: budget ? { ...budget, month } : null,
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
