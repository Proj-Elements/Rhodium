import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api";
import { monthStart, parseMonth, todayInShanghai } from "@/lib/domain";
import { withLedgerWrite } from "@/lib/ledger-write";
import { badRequest } from "@/lib/errors";
import { getMonthSummary } from "@/lib/summary";
import { syncSubscriptions } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ month: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    if (month > todayInShanghai().slice(0, 7)) return jsonError("未来月份还不能结算", 400);
    const settlement = await withLedgerWrite(async (tx) => {
      await syncSubscriptions(undefined, tx);
      const summary = await getMonthSummary(month, tx);
      const values = [summary.budgetCents, summary.expenseCents, summary.incomeCents, summary.remainingCents];
      if (values.some((value) => value !== null && (!Number.isSafeInteger(value) || value < -2_147_483_648 || value > 2_147_483_647))) {
        throw badRequest("结算合计超出可保存范围，请先调整账目金额");
      }
      return tx.monthlySettlement.upsert({
        where: { month: monthStart(month) },
        create: {
          month: monthStart(month),
          // A month with no budget at all settles with 0 and a null remaining, which
          // stays distinguishable from a real 0 budget (remaining would be 0 there).
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
