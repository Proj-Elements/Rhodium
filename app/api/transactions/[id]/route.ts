import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { monthKey } from "@/lib/domain";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { withLedgerWrite } from "@/lib/ledger-write";
import { transactionEditSchema, transactionReimburseSchema, transactionRestoreSchema, transactionUnreimburseSchema } from "@/lib/validation";
import { serializeTransaction, transactionInclude } from "@/lib/serializers";
import { assertTransactionCategory, transactionData } from "@/lib/transactions";
import { isMonthLocked } from "@/lib/summary";
import { recordTransactionHistory } from "@/lib/transaction-history";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const body = await parseJsonBody(request);
    return await withLedgerWrite(async (tx) => {
      const existing = await tx.transaction.findUnique({ where: { id }, include: transactionInclude });
      if (!existing) throw notFound("账目不存在");
      if (await isMonthLocked(monthKey(existing.occurredOn), tx)) throw conflict("本月已经结算，请先重新打开本月");
      if (body !== null && typeof body === "object" && ("restore" in body || "reimburse" in body || "unreimburse" in body)) {
        const action = "restore" in body ? "restore" : "unreimburse" in body ? "unreimburse" : "reimburse";
        const schema = action === "restore" ? transactionRestoreSchema : action === "unreimburse" ? transactionUnreimburseSchema : transactionReimburseSchema;
        const parsed = schema.parse(body);
        if (parsed.expectedVersion !== existing.version) throw conflict("账目已被其他操作修改，请刷新后重试");
        if (action === "restore") {
          if (!existing.deletedAt) throw conflict("这条账目没有被删除，无需恢复");
          await assertTransactionCategory(existing.categoryId, existing.type === "EXPENSE" ? "expense" : "income", tx);
        } else {
          const undo = action === "unreimburse";
          if (existing.type !== "EXPENSE") throw conflict(undo ? "只有支出才能撤销报销" : "只有支出才能标记报销");
          if (existing.deletedAt) throw conflict(undo ? "这条账目已被删除，无法撤销报销" : "这条账目已被删除，无法报销");
          if (undo ? existing.reimbursedAt === null : existing.reimbursedAt !== null) return NextResponse.json({ transaction: serializeTransaction(existing) });
        }
        const transaction = await tx.transaction.update({
          where: { id },
          data: {
            ...(action === "restore" ? { deletedAt: null } : { reimbursedAt: action === "unreimburse" ? null : new Date() }),
            version: { increment: 1 },
          },
          include: transactionInclude,
        });
        await recordTransactionHistory(tx, transaction, action, existing);
        return NextResponse.json({ transaction: serializeTransaction(transaction) });
      }
      if (existing.deletedAt) throw conflict("这条账目已被删除，请先恢复后再编辑");
      const parsed = transactionEditSchema.parse(body);
      if (parsed.expectedVersion !== existing.version) throw conflict("账目已被其他操作修改，请刷新后重试");
      if (existing.source === "SUBSCRIPTION" && parsed.type !== "expense") throw badRequest("订阅账目只能记录支出");
      if (await isMonthLocked(parsed.occurredOn.slice(0, 7), tx)) throw conflict("目标月份已经结算，请先重新打开本月");
      if (parsed.categoryId !== existing.categoryId || parsed.type.toUpperCase() !== existing.type) await assertTransactionCategory(parsed.categoryId, parsed.type, tx);
      const data = transactionData(parsed);
      if (existing.reimbursedAt && (data.amountCents !== existing.amountCents || data.type !== existing.type || data.occurredOn.getTime() !== existing.occurredOn.getTime())) {
        throw conflict("这笔支出已报销，请先明确撤销报销，再修改金额、日期或收支类型");
      }
      const transaction = await tx.transaction.update({ where: { id }, data: { ...data, version: { increment: 1 } }, include: transactionInclude });
      await recordTransactionHistory(tx, transaction, "edit", existing);
      return NextResponse.json({ transaction: serializeTransaction(transaction) });
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return await withLedgerWrite(async (tx) => {
      const existing = await tx.transaction.findUnique({ where: { id }, include: transactionInclude });
      if (!existing) throw notFound("账目不存在");
      if (await isMonthLocked(monthKey(existing.occurredOn), tx)) throw conflict("本月已经结算，请先重新打开本月");
      const versionValue = new URL(request.url).searchParams.get("expectedVersion") ?? "";
      if (!/^[1-9]\d*$/.test(versionValue) || !Number.isSafeInteger(Number(versionValue))) throw badRequest("删除账目需要有效的 expectedVersion");
      if (Number(versionValue) !== existing.version) throw conflict("账目已被其他操作修改，请刷新后重试");
      if (existing.deletedAt) return NextResponse.json({ id, deleted: true, version: existing.version, transaction: serializeTransaction(existing) });
      const transaction = await tx.transaction.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } }, include: transactionInclude });
      await recordTransactionHistory(tx, transaction, "delete", existing);
      return NextResponse.json({ id, deleted: true, version: transaction.version, transaction: serializeTransaction(transaction) });
    });
  } catch (error) {
    return handleApiError(error);
  }
}
