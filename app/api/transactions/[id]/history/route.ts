import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { withLedgerRead } from "@/lib/ledger-write";
import { historyPage } from "@/lib/history-page";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { limit, cursor } = historyPage(request);
    const history = await withLedgerRead(async (tx) => {
      if (!await tx.transaction.findUnique({ where: { id }, select: { id: true } })) throw notFound("账目不存在");
      return tx.transactionHistory.findMany({ where: { transactionId: id, ...(cursor ? { version: { lt: cursor } } : {}) }, orderBy: { version: "desc" }, take: limit + 1 });
    });
    const page = history.slice(0, limit);
    return NextResponse.json({ history: page, nextCursor: history.length > limit ? page.at(-1)!.version : null });
  } catch (error) {
    return handleApiError(error);
  }
}
