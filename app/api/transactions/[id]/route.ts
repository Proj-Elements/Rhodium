import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { monthKey } from "@/lib/domain";
import { conflict, notFound } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { transactionReimburseSchema, transactionRestoreSchema, transactionSchema } from "@/lib/validation";
import { serializeTransaction, transactionInclude } from "@/lib/serializers";
import { assertTransactionCategory, transactionData } from "@/lib/transactions";
import { isMonthLocked } from "@/lib/summary";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const existing = await prisma.transaction.findUnique({ where: { id }, select: { occurredOn: true, deletedAt: true, type: true, categoryId: true, reimbursedAt: true } });
    if (!existing) throw notFound("账目不存在");
    if (await isMonthLocked(monthKey(existing.occurredOn))) throw conflict("本月已经结算，请先重新打开本月");

    // Reimburse is its own strict body ({ reimburse: true }) so it cannot
    // smuggle other fields past transactionSchema. Reimbursement is an
    // accounting fact, not a ledger edit: the row keeps its amount, category
    // and date, and only the timestamp flips.
    if (transactionReimburseSchema.safeParse(body).success) {
      if (existing.type !== "EXPENSE") throw conflict("只有支出才能标记报销");
      if (existing.deletedAt) throw conflict("这条账目已被删除，无法报销");
      if (existing.reimbursedAt) return NextResponse.json({ transaction: serializeTransaction(await prisma.transaction.findUniqueOrThrow({ where: { id }, include: transactionInclude })) });
      const reimbursed = await prisma.transaction.update({
        where: { id },
        data: { reimbursedAt: new Date() },
        include: transactionInclude,
      });
      return NextResponse.json({ transaction: serializeTransaction(reimbursed) });
    }

    // Restore is its own strict body so it cannot smuggle other fields past
    // transactionSchema, and it only applies to a soft-deleted row.
    if (transactionRestoreSchema.safeParse(body).success) {
      if (!existing.deletedAt) throw conflict("这条账目没有被删除，无需恢复");
      // The row may have sat deleted for a while: refuse to bring it back on a
      // category that was archived or retyped meanwhile.
      await assertTransactionCategory(existing.categoryId, existing.type === "EXPENSE" ? "expense" : "income");
      const restored = await prisma.transaction.update({
        where: { id },
        data: { deletedAt: null },
        include: transactionInclude,
      });
      return NextResponse.json({ transaction: serializeTransaction(restored) });
    }

    // Soft-deleted rows are invisible everywhere else; editing them in place
    // would return a DTO that hides deletedAt and pretend the row is live.
    if (existing.deletedAt) throw conflict("这条账目已被删除，请先恢复后再编辑");

    const parsed = transactionSchema.parse(body);
    if (await isMonthLocked(parsed.occurredOn.slice(0, 7))) throw conflict("目标月份已经结算，请先重新打开本月");
    await assertTransactionCategory(parsed.categoryId, parsed.type);
    // 报销状态只能通过 { reimburse: true } 设置；完整编辑只能撤销报销
    //（改金额/改日期前先取消报销，避免已报销的账目被偷偷改掉）。
    const transaction = await prisma.transaction.update({
      where: { id },
      data: { ...transactionData(parsed), reimbursedAt: null },
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
    // 报销是会计事实，删除也一样：软删除保留 reimbursedAt，恢复后仍是已报销状态。
    const transaction = await prisma.transaction.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ id: transaction.id, deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
