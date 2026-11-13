import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { monthStart, parseMonth } from "@/lib/domain";
import { withLedgerRead } from "@/lib/ledger-write";
import { historyPage } from "@/lib/history-page";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ month: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    const { limit, cursor } = historyPage(request);
    const history = await withLedgerRead((tx) => tx.settlementHistory.findMany({
      where: { month: monthStart(month), ...(cursor ? { revision: { lt: cursor } } : {}) },
      orderBy: { revision: "desc" },
      take: limit + 1,
    }));
    const page = history.slice(0, limit);
    return NextResponse.json({ history: page, nextCursor: history.length > limit ? page.at(-1)!.revision : null });
  } catch (error) {
    return handleApiError(error);
  }
}
