import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api";
import { monthStart, parseMonth, todayInShanghai } from "@/lib/domain";
import { conflict } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getMonthSummary } from "@/lib/summary";
import { syncSubscriptions } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ month: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    if (month > todayInShanghai().slice(0, 7)) return jsonError("未来月份还不能结算", 400);
    await syncSubscriptions();
    const summary = await getMonthSummary(month);
    const settlement = await prisma.monthlySettlement.upsert({
      where: { month: monthStart(month) },
      create: {
        month: monthStart(month),
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
    return NextResponse.json({
      settlement: {
        month,
        budgetAmountCents: settlement.budgetAmountCents,
        expenseAmountCents: settlement.expenseAmountCents,
        incomeAmountCents: settlement.incomeAmountCents,
        remainingAmountCents: settlement.remainingAmountCents,
        settledAt: settlement.settledAt.toISOString(),
        reopenedAt: settlement.reopenedAt ? settlement.reopenedAt.toISOString() : null,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
