import { NextResponse } from "next/server";
import { TransactionType } from "@prisma/client";
import { handleApiError, parseJsonBody, monthRange } from "@/lib/api";
import { parseMonth, todayInShanghai } from "@/lib/domain";
import { conflict } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { withLedgerWrite } from "@/lib/ledger-write";
import { ensureDefaultCategories } from "@/lib/seed";
import { serializeTransaction, transactionInclude } from "@/lib/serializers";
import { transactionSchema } from "@/lib/validation";
import { isMonthLocked } from "@/lib/summary";
import { assertTransactionCategory, transactionData } from "@/lib/transactions";
import { syncSubscriptions } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") || todayInShanghai().slice(0, 7);
    parseMonth(month);
    const type = url.searchParams.get("type");
    // Seeding is no longer repeated here: every write path and the categories
    // route seed on demand, so GET only materialises due subscriptions.
    await syncSubscriptions();
    const { start, nextStart } = monthRange(month);
    const [transactions, readOnly] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          deletedAt: null,
          occurredOn: { gte: start, lt: nextStart },
          ...(type === "expense" || type === "income" ? { type: type === "expense" ? TransactionType.EXPENSE : TransactionType.INCOME } : {}),
        },
        include: transactionInclude,
        orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
      }),
      isMonthLocked(month),
    ]);
    return NextResponse.json({ month, readOnly, transactions: transactions.map(serializeTransaction) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = transactionSchema.parse(await parseJsonBody(request));
    const transaction = await withLedgerWrite(async (tx) => {
      if (await isMonthLocked(body.occurredOn.slice(0, 7), tx)) throw conflict("本月已经结算，请先重新打开本月");
      await ensureDefaultCategories(tx);
      await assertTransactionCategory(body.categoryId, body.type, tx);
      return tx.transaction.create({ data: transactionData(body), include: transactionInclude });
    });
    return NextResponse.json({ transaction: serializeTransaction(transaction) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
