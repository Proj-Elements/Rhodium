import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api";
import { monthDate, parseMonth, todayInShanghai } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { getMonthSummary } from "@/lib/summary";
import { syncSubscriptions } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

type Context = { params: { month: string } };

export async function POST(_request: Request, { params }: Context) {
  try {
    parseMonth(params.month);
    if (params.month > todayInShanghai().slice(0, 7)) return jsonError("未来月份还不能结算");
    await syncSubscriptions();
    const summary = await getMonthSummary(params.month);
    const settlement = await prisma.monthlySettlement.upsert({
      where: { month: monthDate(params.month) },
      create: {
        month: monthDate(params.month),
        budgetAmountCents: summary.budgetCents ?? 0,
        expenseAmountCents: summary.expenseCents,
        incomeAmountCents: summary.incomeCents,
        remainingAmountCents: summary.remainingCents,
        reopenedAt: null,
      },
      update: {
        budgetAmountCents: summary.budgetCents ?? 0,
        expenseAmountCents: summary.expenseCents,
        incomeAmountCents: summary.incomeCents,
        remainingAmountCents: summary.remainingCents,
        settledAt: new Date(),
        reopenedAt: null,
      },
    });
    return NextResponse.json({ settlement: { ...settlement, month: params.month } });
  } catch (error) {
    return handleApiError(error);
  }
}
