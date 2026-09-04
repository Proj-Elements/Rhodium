import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { monthKey } from "@/lib/domain";
import { conflict, notFound } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { transactionRestoreSchema, transactionSchema } from "@/lib/validation";
import { serializeTransaction, transactionInclude } from "@/lib/serializers";
import { assertTransactionCategory, transactionData } from "@/lib/transactions";
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
    if (transactionRestoreSchema.safeParse(body).success) {
      const restored = await prisma.transaction.update({
        where: { id },
        data: { deletedAt: null },
        include: transactionInclude,
      });
      return NextResponse.json({ transaction: serializeTransaction(restored) });
    }
    const parsed = transactionSchema.parse(body);
    if (await isMonthLocked(parsed.occurredOn.slice(0, 7))) throw conflict("目标月份已经结算，请先重新打开本月");
    await assertTransactionCategory(parsed.categoryId, parsed.type);
    const transaction = await prisma.transaction.update({
      where: { id },
      data: transactionData(parsed),
      include: transactionInclude,
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
