import { NextResponse } from "next/server";
import { TransactionType } from "@prisma/client";
import { handleApiError, parseJsonBody, jsonError } from "@/lib/api";
import { moneyToCents, parseDateOnly } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { transactionSchema } from "@/lib/validation";
import { serializeTransaction } from "@/lib/serializers";
import { isMonthLocked } from "@/lib/summary";
import { monthKey } from "@/lib/domain";

export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const body = await parseJsonBody(request);
    const existing = await prisma.transaction.findUnique({ where: { id: params.id }, select: { occurredOn: true } });
    if (!existing) return jsonError("账目不存在", 404);
    if (await isMonthLocked(monthKey(existing.occurredOn))) return jsonError("本月已经结算，请先重新打开本月", 409);
    if (body.restore === true) {
      const restored = await prisma.transaction.update({
        where: { id: params.id },
        data: { deletedAt: null },
        include: { category: true, subscription: { select: { name: true } } },
      });
      return NextResponse.json({ transaction: serializeTransaction(restored) });
    }
    const parsed = transactionSchema.parse(body);
    const occurredOn = parseDateOnly(parsed.occurredOn);
    if (await isMonthLocked(parsed.occurredOn.slice(0, 7))) return jsonError("目标月份已经结算，请先重新打开本月", 409);
    const category = await prisma.category.findFirst({
      where: { id: parsed.categoryId, archivedAt: null, OR: [{ type: "BOTH" }, { type: parsed.type === "expense" ? "EXPENSE" : "INCOME" }] },
    });
    if (!category) return jsonError("请选择有效的分类");
    const transaction = await prisma.transaction.update({
      where: { id: params.id },
      data: {
        type: parsed.type === "expense" ? TransactionType.EXPENSE : TransactionType.INCOME,
        amountCents: moneyToCents(parsed.amount),
        occurredOn,
        categoryId: parsed.categoryId,
        note: parsed.note?.trim() || null,
      },
      include: { category: true, subscription: { select: { name: true } } },
    });
    return NextResponse.json({ transaction: serializeTransaction(transaction) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const existing = await prisma.transaction.findUnique({ where: { id: params.id }, select: { occurredOn: true } });
    if (!existing) return jsonError("账目不存在", 404);
    if (await isMonthLocked(monthKey(existing.occurredOn))) return jsonError("本月已经结算，请先重新打开本月", 409);
    const transaction = await prisma.transaction.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ id: transaction.id, deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
