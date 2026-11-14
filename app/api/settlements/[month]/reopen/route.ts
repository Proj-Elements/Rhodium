import { NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/lib/api";
import { monthStart, parseMonth } from "@/lib/domain";
import { conflict, notFound } from "@/lib/errors";
import { withLedgerWrite } from "@/lib/ledger-write";
import { serializeSettlement } from "@/lib/serializers";
import { invalidateSubscriptionSyncCache, syncSubscriptions } from "@/lib/subscriptions";
import { expectedVersionSchema } from "@/lib/validation";
import { recordSettlementHistory } from "@/lib/settlement-history";
import { nextLedgerVersion } from "@/lib/ledger-version";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ month: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { month } = await params;
    parseMonth(month);
    const { expectedVersion } = expectedVersionSchema.parse(await parseJsonBody(request));
    // Explicit existence check: relying on P2025 produced the generic "请求的数据不存在".
    const settlement = await withLedgerWrite(async (tx) => {
      const existing = await tx.monthlySettlement.findUnique({ where: { month: monthStart(month) }, select: { reopenedAt: true, revision: true } });
      if (!existing) throw notFound("这个月还没有结算，无需重新打开");
      if (existing.revision !== expectedVersion) throw conflict("结算已被其他操作修改，请刷新后重试");
      if (existing.reopenedAt) throw conflict("这个月已经是打开状态");
      const updated = await tx.monthlySettlement.update({ where: { month: monthStart(month) }, data: { reopenedAt: new Date(), revision: nextLedgerVersion(existing.revision, "结算") } });
      await recordSettlementHistory(tx, updated, "reopen");
      await syncSubscriptions(undefined, tx, { month });
      return updated;
    });
    // Occurrences skipped while the month was locked can now materialize, so a
    // cached sync run must not keep answering with the pre-reopen plan.
    invalidateSubscriptionSyncCache();
    return NextResponse.json({ settlement: serializeSettlement(settlement) });
  } catch (error) {
    return handleApiError(error);
  }
}
