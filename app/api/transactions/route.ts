import { NextResponse } from "next/server";
import { TransactionType } from "@prisma/client";
import { handleApiError, parseJsonBody, jsonError, monthRange } from "@/lib/api";
import { moneyToCents, parseDateOnly, parseMonth, todayInShanghai } from "@/lib/domain";
import { conflict } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCategories } from "@/lib/seed";
import { serializeTransaction } from "@/lib/serializers";
import { transactionSchema } from "@/lib/validation";
import { isMonthLocked } from "@/lib/summary";
import { syncSubscriptions } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") || todayInShanghai().slice(0, 7);
    parseMonth(month);
    const type = url.searchParams.get("type");
    await syncSubscriptions();
    const { start, nextStart } = monthRange(month);
    const transactions = await prisma.transaction.findMany({
      where: {
        deletedAt: null,
        occurredOn: { gte: start, lt: nextStart },
        ...(type === "expense" || type === "income" ? { type: type === "expense" ? TransactionType.EXPENSE : TransactionType.INCOME } : {}),
      },
      include: { category: true, subscription: { select: { name: true } } },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ month, readOnly: await isMonthLocked(month), transactions: transactions.map(serializeTransaction) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = transactionSchema.parse(await parseJsonBody(request));
    const amountCents = moneyToCents(body.amount);
    const occurredOn = parseDateOnly(body.occurredOn);
    if (await isMonthLocked(body.occurredOn.slice(0, 7))) throw conflict("本月已经结算，请先重新打开本月");
    await ensureDefaultCategories();
    const category = await prisma.category.findFirst({
      where: { id: body.categoryId, archivedAt: null, OR: [{ type: "BOTH" }, { type: body.type === "expense" ? "EXPENSE" : "INCOME" }] },
    });
    if (!category) return jsonError("请选择有效的分类");
    const transaction = await prisma.transaction.create({
      data: {
        type: body.type === "expense" ? TransactionType.EXPENSE : TransactionType.INCOME,
        amountCents,
        occurredOn,
        categoryId: body.categoryId,
        note: body.note?.trim() || null,
      },
      include: { category: true, subscription: { select: { name: true } } },
    });
    return NextResponse.json({ transaction: serializeTransaction(transaction) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
