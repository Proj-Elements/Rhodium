import { dateOnlyKey } from "@/lib/domain";
import type { CategoryDTO, TransactionDTO } from "@/lib/types";
import type { Category, Transaction } from "@prisma/client";

type TransactionWithRelations = Transaction & {
  category: Category;
  subscription: { name: string } | null;
};

/**
 * Whitelist a Prisma Transaction into the client-facing TransactionDTO.
 * Deliberately excludes internal fields (deletedAt, subscriptionOccurrenceKey,
 * timestamps) so they never leak to the client.
 */
export function serializeTransaction(transaction: TransactionWithRelations): TransactionDTO {
  return {
    id: transaction.id,
    type: transaction.type,
    amountCents: transaction.amountCents,
    occurredOn: dateOnlyKey(transaction.occurredOn),
    category: serializeCategory(transaction.category),
    note: transaction.note,
    source: transaction.source,
    subscriptionId: transaction.subscriptionId,
    subscriptionMonth: transaction.subscriptionMonth ? dateOnlyKey(transaction.subscriptionMonth) : null,
    subscription: transaction.subscription ? { name: transaction.subscription.name } : null,
  };
}

/** Whitelist a Prisma Category into the client-facing CategoryDTO. */
export function serializeCategory(category: Category): CategoryDTO {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    isSystem: category.isSystem,
    sortOrder: category.sortOrder,
    archivedAt: category.archivedAt ? dateOnlyKey(category.archivedAt) : null,
  };
}

/** Whitelist a settlement row for client consumption (month as YYYY-MM-DD key). */
export function serializeSettlement(settlement: {
  id: string;
  month: Date;
  budgetAmountCents: number;
  expenseAmountCents: number;
  incomeAmountCents: number;
  remainingAmountCents: number | null;
  settledAt: Date;
  reopenedAt: Date | null;
}) {
  return {
    id: settlement.id,
    month: dateOnlyKey(settlement.month),
    budgetAmountCents: settlement.budgetAmountCents,
    expenseAmountCents: settlement.expenseAmountCents,
    incomeAmountCents: settlement.incomeAmountCents,
    remainingAmountCents: settlement.remainingAmountCents,
    settledAt: settlement.settledAt.toISOString(),
    reopenedAt: settlement.reopenedAt ? settlement.reopenedAt.toISOString() : null,
  };
}
