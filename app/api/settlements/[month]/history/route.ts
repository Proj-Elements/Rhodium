import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { monthStart, parseMonth } from "@/lib/domain";
import { withLedgerRead } from "@/lib/ledger-write";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ month: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    const history = await withLedgerRead((tx) => tx.settlementHistory.findMany({
      where: { month: monthStart(month) },
      orderBy: { revision: "desc" },
    }));
    return NextResponse.json({ history });
  } catch (error) {
    return handleApiError(error);
  }
}
