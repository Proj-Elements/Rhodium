import { NextResponse } from "next/server";
import { TransactionType } from "@prisma/client";
import { calculateRemaining, calculateUsage, dateOnlyKey, daysInMonth, parseMonth, todayInShanghai } from "@/lib/domain";
import { handleApiError, monthRange } from "@/lib/api";
import { withLedgerRead } from "@/lib/ledger-write";
import { serializeTransaction, transactionInclude } from "@/lib/serializers";
import { resolveBudget } from "@/lib/budget";
import { settlementCategorySnapshot } from "@/lib/summary";
import { budgetVersion } from "@/lib/budget-version";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") || todayInShanghai().slice(0, 7);
    parseMonth(month);
    const { start, end } = monthRange(month);
    const today = todayInShanghai();
    const currentMonth = today.slice(0, 7);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const monthStatus: "past" | "current" | "future" = month < currentMonth ? "past" : month > currentMonth ? "future" : "current";
    const focusDate = monthStatus === "current" ? todayDate : monthStatus === "past" ? end : start;
    const recentStart = new Date(focusDate);
    recentStart.setUTCDate(recentStart.getUTCDate() - 6);
    const chartStart = month === currentMonth || recentStart >= start ? recentStart : start;
    const chartDayCount = Math.floor((focusDate.getTime() - chartStart.getTime()) / 86_400_000) + 1;

    const monthTxWhere = { deletedAt: null as null, occurredOn: { gte: start, lte: end } };
    // 报销的支出不占预算：支出合计排除它们，报销额与笔数单独聚合。
    const monthExpenseWhere = { ...monthTxWhere, type: TransactionType.EXPENSE };
    const [budget, expense, reimbursed, income, focusGroups, transactions, grouped, transactionCount, expenseTransactionCount, recentExpenseGroups, recentIncomeGroups, categories, settlement, observedBudgetVersion] = await withLedgerRead((tx) => Promise.all([
      resolveBudget(month, tx),
      tx.transaction.aggregate({
        where: { ...monthExpenseWhere, reimbursedAt: null },
        _sum: { amountCents: true },
      }),
      tx.transaction.aggregate({
        where: { ...monthExpenseWhere, reimbursedAt: { not: null } },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      tx.transaction.aggregate({
        where: { ...monthTxWhere, type: TransactionType.INCOME },
        _sum: { amountCents: true },
      }),
      // One grouped query for focus-date expense+income (was two aggregates).
      tx.transaction.groupBy({
        by: ["occurredOn", "type"],
        where: { deletedAt: null, occurredOn: { equals: focusDate }, OR: [{ type: TransactionType.INCOME }, { reimbursedAt: null }] },
        _sum: { amountCents: true },
      }),
      tx.transaction.findMany({
        where: monthTxWhere,
        include: transactionInclude,
        orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
        take: 10,
      }),
      // Grouping by category through the relation avoids the follow-up
      // category.findMany that used to run after this batch.
      // 分类排行只统计未报销的支出：报销的那笔钱已经回来了。
      tx.transaction.groupBy({
        by: ["categoryId"],
        where: { ...monthExpenseWhere, reimbursedAt: null },
        _sum: { amountCents: true },
        orderBy: { _sum: { amountCents: "desc" } },
      }),
      tx.transaction.count({ where: monthTxWhere }),
      tx.transaction.count({ where: { ...monthTxWhere, type: TransactionType.EXPENSE } }),
      tx.transaction.groupBy({
        by: ["occurredOn"],
        where: { type: TransactionType.EXPENSE, deletedAt: null, reimbursedAt: null, occurredOn: { gte: chartStart, lte: focusDate } },
        _sum: { amountCents: true },
      }),
      tx.transaction.groupBy({
        by: ["occurredOn"],
        where: { type: TransactionType.INCOME, deletedAt: null, occurredOn: { gte: chartStart, lte: focusDate } },
        _sum: { amountCents: true },
      }),
      // Categories are a tiny table; loading them here avoids a second
      // sequential round trip once the expense grouping is known.
      tx.category.findMany({ select: { id: true, name: true } }),
      tx.monthlySettlement.findUnique({ where: { month: start } }),
      budgetVersion(tx, month),
    ]));

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
    const reimbursedCents = reimbursed._sum.amountCents ?? 0;
    const settled = settlement !== null && settlement.reopenedAt === null;
    const budgetCents = settled
      ? settlement.remainingAmountCents === null
        ? null
        : settlement.budgetAmountCents
      : budget.amountCents;
    const outOfPocketCents = settled
      ? settlement.remainingAmountCents === null
        ? settlement.expenseAmountCents - reimbursedCents
        : settlement.budgetAmountCents - settlement.remainingAmountCents
      : expense._sum.amountCents ?? 0;
    const incomeCents = settled ? settlement.incomeAmountCents : income._sum.amountCents ?? 0;
    // Match monthly summaries: expenseCents is gross; budgeting uses self-paid expenses.
    const expenseCents = settled ? settlement.expenseAmountCents : outOfPocketCents + reimbursedCents;
    const remainingCents = settled ? settlement.remainingAmountCents : calculateRemaining(budgetCents, outOfPocketCents);
    const capturedCategories = settled ? settlementCategorySnapshot(settlement.categorySnapshot) : null;
    const categoryBreakdown = capturedCategories
      ? capturedCategories.filter((item) => item.outOfPocketCents > 0).map((item) => ({
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        amountCents: item.outOfPocketCents,
      })).sort((first, second) => second.amountCents - first.amountCents)
      : grouped.map((item) => ({
        categoryId: item.categoryId,
        categoryName: categoryMap.get(item.categoryId) || "其他",
        amountCents: item._sum.amountCents ?? 0,
      }));
    return NextResponse.json({
      month,
      today,
      focusDate: dateOnlyKey(focusDate),
      budget: budgetCents === null ? null : { amountCents: budgetCents },
      budgetSource: settled ? "settlement" : budget.source,
      budgetVersion: observedBudgetVersion,
      locked: settled,
      readOnly: settled,
      expenseCents,
      outOfPocketCents,
      reimbursedCents,
      reimbursedCount: reimbursed._count._all,
      incomeCents,
      remainingCents,
      usagePercent: calculateUsage(budgetCents, outOfPocketCents),
      focusDateExpenseCents,
      focusDateIncomeCents,
      transactionCount,
      expenseTransactionCount,
      monthStatus,
      daysElapsed: monthStatus === "current" ? Number(today.slice(8, 10)) : monthStatus === "past" ? daysInMonth(month) : 0,
      daysInMonth: daysInMonth(month),
      categoryBreakdown,
      recentExpenses,
      recentTransactions: transactions.map(serializeTransaction),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
