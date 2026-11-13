import { NextResponse } from "next/server";
import { type Prisma, TransactionType } from "@prisma/client";
import { handleApiError, parseJsonBody, monthRange } from "@/lib/api";
import { monthKey, parseMonth, todayInShanghai } from "@/lib/domain";
import { badRequest, conflict } from "@/lib/errors";
import { withLedgerRead, withLedgerWrite } from "@/lib/ledger-write";
import { ensureDefaultCategories } from "@/lib/seed";
import { serializeTransaction, transactionInclude } from "@/lib/serializers";
import { transactionSchema } from "@/lib/validation";
import { getLockedMonths, isMonthLocked } from "@/lib/summary";
import { assertTransactionCategory, transactionData } from "@/lib/transactions";
import { recordTransactionHistory } from "@/lib/transaction-history";
import { creationIdentity, replayCreation } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") || todayInShanghai().slice(0, 7);
    if (month !== "all") parseMonth(month);
    const type = url.searchParams.get("type");
    if (type && type !== "expense" && type !== "income") throw badRequest("收支类型无效");
    const deleted = url.searchParams.get("deleted");
    if (deleted && deleted !== "only" && deleted !== "exclude") throw badRequest("删除状态无效");
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (query.length > 200) throw badRequest("搜索内容最多 200 字");
    const categoryId = url.searchParams.get("categoryId");
    if (categoryId && categoryId.length > 60) throw badRequest("分类标识无效");
    const limitValue = url.searchParams.get("limit") ?? "500";
    if (!/^\d+$/.test(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 2000) throw badRequest("每页条数必须是 1 到 2000 的整数");
    const limit = Number(limitValue);
    const cursor = url.searchParams.get("cursor");
    if (cursor && cursor.length > 60) throw badRequest("分页游标无效");
    const result = await withLedgerRead(async (tx) => {
      const range = month === "all" ? null : monthRange(month);
      const where: Prisma.TransactionWhereInput = {
        deletedAt: deleted === "only" ? { not: null } : null,
        ...(range ? { occurredOn: { gte: range.start, lt: range.nextStart } } : {}),
        ...(type ? { type: type === "expense" ? TransactionType.EXPENSE : TransactionType.INCOME } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(query ? { OR: [
          { note: { contains: query, mode: "insensitive" } },
          { category: { name: { contains: query, mode: "insensitive" } } },
          { subscription: { name: { contains: query, mode: "insensitive" } } },
        ] } : {}),
      };
      const [rows, totals, reimbursed] = await Promise.all([
        tx.transaction.findMany({
          where,
          include: transactionInclude,
          orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
        tx.transaction.groupBy({ by: ["type"], where, _sum: { amountCents: true }, _count: { _all: true } }),
        tx.transaction.aggregate({ where: { AND: [where, { type: "EXPENSE", reimbursedAt: { not: null } }] }, _sum: { amountCents: true }, _count: { _all: true } }),
      ]);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const locked = new Set(await getLockedMonths([
        ...(month === "all" ? [] : [month]),
        ...page.map((transaction) => monthKey(transaction.occurredOn)),
      ], tx));
      const expenseCents = totals.find((total) => total.type === "EXPENSE")?._sum.amountCents ?? 0;
      const reimbursedCents = reimbursed._sum.amountCents ?? 0;
      return {
        month,
        readOnly: month !== "all" && locked.has(month),
        transactions: page.map((transaction) => ({
          ...serializeTransaction(transaction),
          monthLocked: locked.has(monthKey(transaction.occurredOn)),
        })),
        nextCursor: hasMore ? page[page.length - 1].id : null,
        summary: {
          expenseCents,
          outOfPocketCents: expenseCents - reimbursedCents,
          incomeCents: totals.find((total) => total.type === "INCOME")?._sum.amountCents ?? 0,
          reimbursedCents,
          reimbursedCount: reimbursed._count._all,
          transactionCount: totals.reduce((sum, total) => sum + total._count._all, 0),
        },
      };
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = transactionSchema.parse(await parseJsonBody(request));
    const data = transactionData(body);
    const identity = creationIdentity(request, "transaction", data);
    const result = await withLedgerWrite(async (tx) => {
      const replay = await replayCreation(tx, identity, request.headers.get("idempotency-key"));
      if (replay) return { response: replay, replayed: true };
      if (await isMonthLocked(body.occurredOn.slice(0, 7), tx)) throw conflict("本月已经结算，请先重新打开本月");
      await ensureDefaultCategories(tx);
      await assertTransactionCategory(body.categoryId, body.type, tx);
      const transaction = await tx.transaction.create({ data, include: transactionInclude });
      await recordTransactionHistory(tx, transaction, "create");
      const response = { transaction: serializeTransaction(transaction) };
      if (identity.key) await tx.creationRequest.create({ data: { ...identity, key: identity.key, response: response as unknown as Prisma.InputJsonObject } });
      return { response, replayed: false };
    });
    return NextResponse.json(result.response, { status: 201, headers: { "Idempotent-Replay": String(result.replayed) } });
  } catch (error) {
    return handleApiError(error);
  }
}
