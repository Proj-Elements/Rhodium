import { CategoryType, TransactionType } from "@prisma/client";
import { parseDateOnly } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { resetSeedCache } from "@/lib/seed";
import { resetSubscriptionSyncCache } from "@/lib/subscriptions";
import { assertTestDatabaseIdentity, requireTestDatabase, type TestDatabaseIdentity } from "@/lib/test-database";

const TABLES = ["Transaction", "Subscription", "MonthlyBudget", "BudgetPreset", "MonthlySettlement", "Category"]
  .map((table) => `"public"."${table}"`)
  .join(", ");

/**
 * Empty only an explicitly opted-in test database. The database owner must mark
 * a fresh disposable DB with COMMENT ON DATABASE <name> IS 'rhodium:test-database'.
 * Verify and truncate on one transaction connection; never cache this approval.
 */
export async function resetDatabase() {
  const target = requireTestDatabase(process.env);
  if (process.env.DATABASE_URL !== target.url) throw new Error("DATABASE_URL 与已批准的 TEST_DATABASE_URL 不一致，拒绝清空数据库");
  await prisma.$transaction(async (tx) => {
    const identities = await tx.$queryRaw<TestDatabaseIdentity[]>`
      SELECT current_database() AS database, current_user AS user, current_schema() AS schema,
        shobj_description(oid, 'pg_database') AS marker
      FROM pg_database WHERE datname = current_database()
    `;
    assertTestDatabaseIdentity(target, identities[0]);
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES} RESTART IDENTITY CASCADE`);
  });
  resetSeedCache();
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
