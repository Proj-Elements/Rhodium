import { Prisma, type Transaction } from "@prisma/client";
import { dateOnlyKey } from "@/lib/domain";

type HistoricalTransaction = Transaction & { category?: { name: string } };

/** Preserve the values and category label visible when a ledger change happened. */
export function transactionSnapshot(transaction: HistoricalTransaction): Prisma.InputJsonObject {
  return {
    id: transaction.id,
    version: transaction.version,
    type: transaction.type,
    amountCents: transaction.amountCents,
    occurredOn: dateOnlyKey(transaction.occurredOn),
    categoryId: transaction.categoryId,
    categoryName: transaction.category?.name ?? null,
    note: transaction.note,
    source: transaction.source,
    subscriptionId: transaction.subscriptionId,
    subscriptionMonth: transaction.subscriptionMonth ? dateOnlyKey(transaction.subscriptionMonth) : null,
    reimbursedAt: transaction.reimbursedAt?.toISOString() ?? null,
    deletedAt: transaction.deletedAt?.toISOString() ?? null,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}

/** Record the resulting ledger version in the same database transaction as its write. */
export function recordTransactionHistory(
  tx: Prisma.TransactionClient,
  after: HistoricalTransaction,
  action: string,
  before?: HistoricalTransaction,
) {
  return tx.transactionHistory.create({ data: {
    transactionId: after.id,
    version: after.version,
    action,
    before: before ? transactionSnapshot(before) : Prisma.DbNull,
    after: transactionSnapshot(after),
  } });
}
