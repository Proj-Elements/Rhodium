import { dateOnlyKey } from "@/lib/domain";
import type { CategoryDTO, SettlementCategorySnapshot, TransactionDTO } from "@/lib/types";
import type { Category, Transaction } from "@prisma/client";

/** Relations every transaction response needs in order to be serialized. */
export const transactionInclude = { category: true, subscription: { select: { name: true } } } as const;

type TransactionWithRelations = Transaction & {
  category: Category;
  subscription: { name: string } | null;
};

/** 实际生效的金额列：报销的支出按 0 计入支出/预算，其余按原额。 */
export function effectiveExpenseCents(transaction: { type: string; amountCents: number; reimbursedAt: Date | null }): number {
  return transaction.type === "EXPENSE" && transaction.reimbursedAt ? 0 : transaction.amountCents;
}

/** Structural shape of the category fields the DTO needs (Prisma row or a narrowed select). */
export type CategoryLike = {
  id: string;
  version?: number;
  name: string;
  type: Category["type"];
  icon: string | null;
  isSystem: boolean;
  sortOrder: number;
  archivedAt: Date | null;
};

/**
 * Whitelist a Prisma Transaction into the client-facing TransactionDTO.
 * Exposes the mutation version and deleted state for conflict handling and recovery.
 */
export function serializeTransaction(transaction: TransactionWithRelations): TransactionDTO {
  return {
    id: transaction.id,
    version: transaction.version,
    deletedAt: transaction.deletedAt?.toISOString() ?? null,
    type: transaction.type,
    amountCents: transaction.amountCents,
    occurredOn: dateOnlyKey(transaction.occurredOn),
    category: serializeCategory(transaction.category),
    note: transaction.note,
    source: transaction.source,
    reimbursedAt: transaction.reimbursedAt ? transaction.reimbursedAt.toISOString() : null,
    subscriptionId: transaction.subscriptionId,
    subscriptionMonth: transaction.subscriptionMonth ? dateOnlyKey(transaction.subscriptionMonth) : null,
    subscription: transaction.subscription ? { name: transaction.subscription.name } : null,
  };
}

/**
 * Whitelist a Prisma Category into the client-facing CategoryDTO.
 * `archivedAt` is an absolute timestamp, so it is serialized in full instead of
 * being truncated to a UTC date (which shifted the day for Shanghai users).
 */
export function serializeCategory(category: CategoryLike): CategoryDTO {
  return {
    id: category.id,
    version: category.version ?? 1,
    name: category.name,
    type: category.type,
    icon: category.icon,
    isSystem: category.isSystem,
    sortOrder: category.sortOrder,
    archivedAt: category.archivedAt ? category.archivedAt.toISOString() : null,
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
  revision?: number;
  categorySnapshot?: unknown;
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
    revision: settlement.revision ?? 1,
    categorySnapshot: settlement.categorySnapshot as SettlementCategorySnapshot[] | null ?? null,
  };
}
