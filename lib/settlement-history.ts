import type { MonthlySettlement, Prisma } from "@prisma/client";
import { serializeSettlement } from "@/lib/serializers";

/** Keep each close/reopen result immutable even when the current settlement changes. */
export function recordSettlementHistory(tx: Prisma.TransactionClient, settlement: MonthlySettlement, action: string) {
  return tx.settlementHistory.create({ data: {
    month: settlement.month,
    revision: settlement.revision,
    action,
    snapshot: serializeSettlement(settlement) as Prisma.InputJsonObject,
  } });
}
