import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { withLedgerRead } from "@/lib/ledger-write";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const history = await withLedgerRead(async (tx) => {
      if (!await tx.transaction.findUnique({ where: { id }, select: { id: true } })) throw notFound("账目不存在");
      return tx.transactionHistory.findMany({ where: { transactionId: id }, orderBy: { version: "desc" } });
    });
    return NextResponse.json({ history });
  } catch (error) {
    return handleApiError(error);
  }
}
