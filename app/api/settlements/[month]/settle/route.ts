import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/api";
import { monthEnd, monthStart, parseMonth, todayInShanghai } from "@/lib/domain";
import { withLedgerWrite } from "@/lib/ledger-write";
import { badRequest } from "@/lib/errors";
import { getMonthSummary } from "@/lib/summary";
import { syncSubscriptions } from "@/lib/subscriptions";
import { serializeSettlement } from "@/lib/serializers";
import { recordSettlementHistory } from "@/lib/settlement-history";
import type { SettlementCategorySnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ month: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    if (month > todayInShanghai().slice(0, 7)) return jsonError("未来月份还不能结算", 400);
    const settlement = await withLedgerWrite(async (tx) => {
      const existing = await tx.monthlySettlement.findUnique({ where: { month: monthStart(month) } });
      if (existing && !existing.reopenedAt) return existing;
      await syncSubscriptions(undefined, tx, { month });
      const summary = await getMonthSummary(month, tx);
      const values = [summary.budgetCents, summary.expenseCents, summary.incomeCents, summary.remainingCents];
      if (values.some((value) => value !== null && (!Number.isSafeInteger(value) || value < -2_147_483_648 || value > 2_147_483_647))) {
        throw badRequest("结算合计超出可保存范围，请先调整账目金额");
      }
      const finalDay = monthEnd(month);
      const transactions = await tx.transaction.findMany({
        where: { deletedAt: null, occurredOn: { gte: monthStart(month), lte: finalDay } },
        select: { categoryId: true, category: { select: { name: true } }, type: true, amountCents: true, reimbursedAt: true },
      });
      const categories = new Map<string, SettlementCategorySnapshot>();
      for (const transaction of transactions) {
        const category = categories.get(transaction.categoryId) ?? {
          categoryId: transaction.categoryId,
          categoryName: transaction.category.name,
          expenseCents: 0,
          outOfPocketCents: 0,
          incomeCents: 0,
        };
        if (transaction.type === "INCOME") category.incomeCents += transaction.amountCents;
        else {
          category.expenseCents += transaction.amountCents;
          if (!transaction.reimbursedAt) category.outOfPocketCents += transaction.amountCents;
        }
        categories.set(category.categoryId, category);
      }
      const categorySnapshot = [...categories.values()];
      const saved = await tx.monthlySettlement.upsert({
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
          categorySnapshot,
          revision: 1,
        },
        update: {
          budgetAmountCents: summary.budgetCents ?? 0,
          expenseAmountCents: summary.expenseCents,
          incomeAmountCents: summary.incomeCents,
          remainingAmountCents: summary.remainingCents,
          settledAt: new Date(),
          reopenedAt: null,
          categorySnapshot,
          revision: { increment: 1 },
        },
      });
      await recordSettlementHistory(tx, saved, "settle");
      return saved;
    });
    return NextResponse.json({
      settlement: { ...serializeSettlement(settlement), month },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
