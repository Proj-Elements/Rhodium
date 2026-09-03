import { NextResponse } from "next/server";
import { TransactionType } from "@prisma/client";
import { handleApiError, parseJsonBody, jsonError } from "@/lib/api";
import { moneyToCents, monthKey, parseDateOnly } from "@/lib/domain";
import { conflict, notFound } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { transactionSchema } from "@/lib/validation";
import { serializeTransaction } from "@/lib/serializers";
import { isMonthLocked } from "@/lib/summary";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const existing = await prisma.transaction.findUnique({ where: { id }, select: { occurredOn: true } });
    if (!existing) throw notFound("账目不存在");
    if (await isMonthLocked(monthKey(existing.occurredOn))) throw conflict("本月已经结算，请先重新打开本月");
    if (body.restore === true) {
      const restored = await prisma.transaction.update({
        where: { id },
        data: { deletedAt: null },
        include: { category: true, subscription: { select: { name: true } } },
      });
      return NextResponse.json({ transaction: serializeTransaction(restored) });
    }
    const parsed = transactionSchema.parse(body);
    const occurredOn = parseDateOnly(parsed.occurredOn);
    if (await isMonthLocked(parsed.occurredOn.slice(0, 7))) throw conflict("目标月份已经结算，请先重新打开本月");
    const category = await prisma.category.findFirst({
      where: { id: parsed.categoryId, archivedAt: null, OR: [{ type: "BOTH" }, { type: parsed.type === "expense" ? "EXPENSE" : "INCOME" }] },
    });
    if (!category) return jsonError("请选择有效的分类");
    const transaction = await prisma.transaction.update({
      where: { id },
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
    const { id } = await params;
    const existing = await prisma.transaction.findUnique({ where: { id }, select: { occurredOn: true } });
    if (!existing) throw notFound("账目不存在");
    if (await isMonthLocked(monthKey(existing.occurredOn))) throw conflict("本月已经结算，请先重新打开本月");
    const transaction = await prisma.transaction.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ id: transaction.id, deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
