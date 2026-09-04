import { CategoryType, TransactionType } from "@prisma/client";
import { parseDateOnly } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { resetSubscriptionSyncCache } from "@/lib/subscriptions";

const TABLES = ["Transaction", "Subscription", "MonthlyBudget", "BudgetPreset", "MonthlySettlement", "Category"]
  .map((table) => `"${table}"`)
  .join(", ");

/** Empty every table and drop process-local caches that outlive a test. */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES} RESTART IDENTITY CASCADE`);
  resetSubscriptionSyncCache();
}

export function createCategory(name = "餐饮", type: CategoryType = CategoryType.EXPENSE) {
  return prisma.category.create({ data: { name, type } });
}

export function addTransaction(options: {
  categoryId: string;
  date: string;
  amountCents: number;
  type?: TransactionType;
}) {
  return prisma.transaction.create({
    data: {
      categoryId: options.categoryId,
      occurredOn: parseDateOnly(options.date),
      amountCents: options.amountCents,
      type: options.type ?? TransactionType.EXPENSE,
    },
  });
}

/** Build the `{ params }` context Next.js route handlers expect. */
export function routeContext<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

export { prisma };
